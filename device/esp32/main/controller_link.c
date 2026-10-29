#include "controller.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>
#include "sdkconfig.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/task.h"

static portMUX_TYPE link_lock = portMUX_INITIALIZER_UNLOCKED;
static char pending_url[1024], resume_token[128], device_id[64];
static char last_join_url[1024];
static bool pending_resume;
static bool pending, restart_link, revoked, neutral_pending, clear_link;
static uint32_t pending_generation, active_generation;
static uint32_t sequence;
static _Atomic uint32_t last_reply;
static char incoming[4096];
static size_t incoming_size;
static esp_websocket_client_handle_t active_client;
static char last_error[48];
void controller_link_error(char *out,size_t size){portENTER_CRITICAL(&link_lock);strlcpy(out,last_error,size);portEXIT_CRITICAL(&link_lock);}

static uint32_t milliseconds(void) { return esp_timer_get_time()/1000; }
static void message(const char *data, size_t length, uint32_t generation) {
    if(generation!=controller_pair_status().generation)return;
    cJSON *json = cJSON_ParseWithLength(data, length);
    if (!json) return;
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(json, "type");
    if (!cJSON_IsString(type)) { cJSON_Delete(json); return; }
    last_reply = milliseconds();
    if (!strcmp(type->valuestring, "bound")) {
        const cJSON *secret = cJSON_GetObjectItemCaseSensitive(json, "resumeToken");
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(json, "deviceId");
        if (cJSON_IsString(secret) && cJSON_IsString(id) &&
            strlen(secret->valuestring) < sizeof(resume_token) && strlen(id->valuestring) < sizeof(device_id)) {
            portENTER_CRITICAL(&link_lock);
            strlcpy(resume_token, secret->valuestring, sizeof(resume_token));
            strlcpy(device_id, id->valuestring, sizeof(device_id)); neutral_pending = true;
            portEXIT_CRITICAL(&link_lock);
            if(controller_pair_update(generation,PAIR_CONNECTED,PAIR_OK)){
                controller_connected(true);controller_feedback(.35f,100);
            }
        }
    } else if (!strcmp(type->valuestring,"rearm")) {
        controller_release();
        portENTER_CRITICAL(&link_lock);neutral_pending=true;portEXIT_CRITICAL(&link_lock);
    } else if (!strcmp(type->valuestring, "closed") || !strcmp(type->valuestring, "error")) {
        const cJSON *code=cJSON_GetObjectItemCaseSensitive(json,"code");
        const char *name=cJSON_IsString(code)?code->valuestring:"connection_error";
        bool denied=!strcmp(name,"binding_revoked")||!strcmp(name,"invalid_token")||!strcmp(name,"wrong_principal");
        portENTER_CRITICAL(&link_lock);
        strlcpy(last_error,name,sizeof(last_error));
        revoked=denied;restart_link=true;
        if(denied)resume_token[0]=device_id[0]=0;
        portEXIT_CRITICAL(&link_lock);
        pair_error_t reason=PAIR_LINK_FAILED;
        if(cJSON_IsString(code)){
            if(strstr(code->valuestring,"pair_"))reason=PAIR_EXPIRED;
            else if(!strcmp(code->valuestring,"game_unavailable"))reason=PAIR_GAME_CLOSED;
            else if(strstr(code->valuestring,"revoked"))reason=PAIR_UNBOUND;
        }
        controller_pair_update(generation,PAIR_ERROR,reason);
        controller_connected(false);
    } else if (!strcmp(type->valuestring, "feedback")) {
        const cJSON *strength = cJSON_GetObjectItemCaseSensitive(json, "strength");
        const cJSON *duration = cJSON_GetObjectItemCaseSensitive(json, "durationMs");
        controller_feedback(cJSON_IsNumber(strength) ? strength->valuedouble : .3,
                            cJSON_IsNumber(duration) ? duration->valueint : 40);
    }
    cJSON_Delete(json);
}
static void socket_event(void *unused, esp_event_base_t base, int32_t id, void *event) {
    (void)unused; (void)base;
    const esp_websocket_event_data_t *frame = event;
    portENTER_CRITICAL(&link_lock);
    bool current = frame && frame->client == active_client;
    uint32_t generation=active_generation;bool stopped=revoked;
    portEXIT_CRITICAL(&link_lock);
    if (!current) return;
    if (id == WEBSOCKET_EVENT_CONNECTED) last_reply = milliseconds();
    if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_ERROR) {
        controller_connected(false);
        portENTER_CRITICAL(&link_lock); restart_link = true; portEXIT_CRITICAL(&link_lock);
        if(!stopped)controller_pair_update(generation,controller_wifi_ready()?PAIR_CONNECTING:PAIR_WIFI,PAIR_OK);
    }
    if (id != WEBSOCKET_EVENT_DATA) return;
    if (frame->op_code != 1 && frame->op_code != 0) return;
    if (frame->payload_offset == 0) incoming_size = 0;
    if (frame->payload_len >= sizeof(incoming) || frame->payload_offset != incoming_size ||
        frame->data_len < 0 || incoming_size + frame->data_len >= sizeof(incoming)) {
        portENTER_CRITICAL(&link_lock); restart_link = true; portEXIT_CRITICAL(&link_lock); return;
    }
    memcpy(incoming + incoming_size, frame->data_ptr, frame->data_len);
    incoming_size += frame->data_len;
    if (incoming_size == frame->payload_len) { incoming[incoming_size] = 0; message(incoming, incoming_size, generation); }
}
void controller_link_reset(void) {
    portENTER_CRITICAL(&link_lock);clear_link=true;pending=false;revoked=true;active_client=NULL;
    portEXIT_CRITICAL(&link_lock);controller_connected(false);
}
bool controller_link_join(const char *source) {
    char checked[1024];
    if (!controller_url_join(source,
#ifdef CONFIG_ANKA_ALLOW_INSECURE_LOCAL
                              true,
#else
                              false,
#endif
                              checked, sizeof(checked))) return false;
    char origin[256];
    if(!controller_url_origin(checked,origin,sizeof(origin)))return false;
    portENTER_CRITICAL(&link_lock);
    pending_resume=resume_token[0]&&device_id[0]&&!strcmp(last_join_url,checked);
    strlcpy(last_join_url,checked,sizeof(last_join_url));
    strlcpy(pending_url, checked, sizeof(pending_url)); pending_generation=controller_pair_status().generation;pending = true;
    portEXIT_CRITICAL(&link_lock);
    return true;
}
static bool send_text(esp_websocket_client_handle_t client, const char *text) {
    return esp_websocket_client_send_text(client, text, strlen(text), pdMS_TO_TICKS(40)) == strlen(text);
}
static void destroy(esp_websocket_client_handle_t *client) {
    portENTER_CRITICAL(&link_lock); active_client = NULL; portEXIT_CRITICAL(&link_lock);
    if (*client) { esp_websocket_client_stop(*client); esp_websocket_client_destroy(*client); *client = NULL; }
    controller_connected(false);
}
static void network(void *unused) {
    (void)unused;
    esp_websocket_client_handle_t client = NULL;
    char url[1024] = {0}, origin[256] = {0};
    uint32_t retry_at = 0, last_input = 0, last_ping = 0, connect_started=0, generation=0;
    unsigned retries = 0;
    bool sntp_started = false;
    controller_state_t previous = {0};
    // SDK URI diagnostics must not print query credentials.
    esp_log_level_set("websocket_client", ESP_LOG_NONE);
    while (true) {
        uint32_t now = milliseconds();
        portENTER_CRITICAL(&link_lock);
        bool replace = pending, reconnect = restart_link, clear=clear_link;
        clear_link=false;
        if(clear)url[0]=0; // Keep this device's in-memory credential for an intentional rescan.
        if (replace) {
            strlcpy(url, pending_url, sizeof(url));
            (void)controller_url_origin(url, origin, sizeof(origin)); pending = false; revoked = false;
            if(!pending_resume)resume_token[0]=device_id[0]=0;
            generation=pending_generation;connect_started=now;
        }
        bool stop=revoked;
        restart_link = false;
        portEXIT_CRITICAL(&link_lock);
        if (replace) retries = 0;
        if (clear || replace || reconnect || (!controller_wifi_ready() && client)) {
            destroy(&client); retry_at = now + (replace ? 400 : 400 * (1 << (retries > 3 ? 3 : retries)));
            if (!replace) retries++;
        }
        if(controller_exiting()){if(client)destroy(&client);vTaskDelay(pdMS_TO_TICKS(100));continue;}
        if(stop){vTaskDelay(pdMS_TO_TICKS(50));continue;}
        if(!controller_session_locked()&&url[0]&&!controller_snapshot(false).connected&&now-connect_started>15000){
            bool clock_bad=!strncmp(url,"wss:",4)&&time(NULL)<1700000000;
            destroy(&client);url[0]=0;
            portENTER_CRITICAL(&link_lock);revoked=true;portEXIT_CRITICAL(&link_lock);
            controller_pair_update(generation,PAIR_ERROR,clock_bad?PAIR_CLOCK:PAIR_LINK_FAILED);continue;
        }
        if (!controller_wifi_ready()) {
            if(url[0]&&now-connect_started>=400)controller_pair_update(generation,PAIR_WIFI,PAIR_OK);
            vTaskDelay(pdMS_TO_TICKS(50));continue;
        }
        if (retries >= 20&&!controller_session_locked()) {
            portENTER_CRITICAL(&link_lock); revoked = true; resume_token[0] = device_id[0] = 0; portEXIT_CRITICAL(&link_lock);
            destroy(&client); controller_ui_notice("无法恢复连接，请重新扫码"); continue;
        }
        if (!sntp_started) { (void)esp_netif_sntp_start(); sntp_started = true; }
        if ((!strncmp(url, "wss:", 4) || !strncmp(url, "https:", 6)) && time(NULL) < 1700000000) { vTaskDelay(pdMS_TO_TICKS(200)); continue; }
        if (!client && now >= retry_at && url[0]) {
            controller_pair_update(generation,PAIR_CONNECTING,PAIR_OK);
            char secret[128], identity[64];
            portENTER_CRITICAL(&link_lock);
            strlcpy(secret, resume_token, sizeof(secret)); strlcpy(identity, device_id, sizeof(identity));
            portEXIT_CRITICAL(&link_lock);
            if (secret[0]) {
                snprintf(url, sizeof(url), "%s/v1/device/reconnect?deviceId=%s&token=%s",
                         origin, identity, secret);
            }
            esp_websocket_client_config_t config = {
                .uri = url, .buffer_size = 4096, .task_stack = 7168,
                .network_timeout_ms = 3000, .disable_auto_reconnect = true,
                .crt_bundle_attach = esp_crt_bundle_attach,
            };
            client = esp_websocket_client_init(&config);
            if (!client) { retries++; retry_at = now+2000; vTaskDelay(pdMS_TO_TICKS(100)); continue; }
            portENTER_CRITICAL(&link_lock); active_client = client;active_generation=generation;portEXIT_CRITICAL(&link_lock);
            esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, socket_event, NULL);
            if (esp_websocket_client_start(client) != ESP_OK) {
                destroy(&client); retries++; retry_at = now+2000;
            }
            last_reply = now;
        }
        controller_state_t state = controller_snapshot(false);
        if(state.connected)connect_started=now;
        if (client && esp_websocket_client_is_connected(client)) {
            if (now-last_reply > 12000) { destroy(&client); retry_at = now+500; continue; }
            if (state.connected) {
                portENTER_CRITICAL(&link_lock);
                bool neutral = neutral_pending; neutral_pending = false;
                portEXIT_CRITICAL(&link_lock);
                if (neutral) {
                    sequence = 0; previous = (controller_state_t){0};
                    char neutral_frame[240];
                    snprintf(neutral_frame,sizeof(neutral_frame),"{\"type\":\"input\",\"seq\":1,\"move\":{\"x\":0,\"y\":0},\"look\":{\"yaw\":0,\"pitch\":0},\"buttons\":{\"fire\":false,\"aim\":false},\"turn\":%.6f,\"turnTotal\":%.6f}",state.turn,state.turn_total);
                    if (!send_text(client,neutral_frame)) { destroy(&client); retry_at = now+500; continue; }
                    sequence = 1;
                }
                bool active = state.move_x || state.move_y || state.yaw || state.pitch || state.orientation_id || state.fire || state.aim;
                bool edge = state.fire != previous.fire || state.aim != previous.aim;
                if (edge || now-last_input >= (active ? 17 : 50)) {
                    state = controller_snapshot(true);
                    char frame[640],pose[180]={0};
                    if(state.orientation_id)snprintf(pose,sizeof(pose),",\"pose\":{\"id\":%"PRIu32",\"q\":[%.7f,%.7f,%.7f,%.7f]}",
                        state.orientation_id,state.orientation.w,state.orientation.x,state.orientation.y,state.orientation.z);
                    snprintf(frame, sizeof(frame), "{\"type\":\"input\",\"seq\":%" PRIu32 ",\"move\":{\"x\":%.6f,\"y\":%.6f},"
                        "\"look\":{\"yaw\":%.6f,\"pitch\":%.6f},\"buttons\":{\"fire\":%s,\"aim\":%s},\"turn\":%.6f,\"turnTotal\":%.6f%s}",
                        ++sequence, state.move_x, state.move_y, state.yaw, state.pitch,
                        state.fire ? "true" : "false", state.aim ? "true" : "false",state.turn,state.turn_total,pose);
                    if (!send_text(client, frame)) { destroy(&client); retry_at = now+500; continue; }
                    last_input = now; previous = state; retries = 0;
                }
                int action;
                while (xQueueReceive(anka_action_queue, &action, 0) == pdTRUE) {
                    char frame[100];
                    snprintf(frame, sizeof(frame), "{\"type\":\"action\",\"seq\":%" PRIu32 ",\"action\":\"%s\"}", ++sequence, anka_actions[action]);
                    if (!send_text(client, frame)) { destroy(&client); break; }
                }
            }
            if (client && now-last_ping >= 3000) { (void)send_text(client, "{\"type\":\"ping\"}"); last_ping = now; }
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
void controller_link_start(void) { xTaskCreate(network, "controller_link", 8192, NULL, 4, NULL); }
