#include "controller.h"
#include <string.h>
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "esp_log.h"
#include "mosaico_shared.h"
#include "nvs.h"
#include "freertos/event_groups.h"

static EventGroupHandle_t events;
static const char *credential_source = "none";
const char *controller_wifi_source(void) { return credential_source; }
bool controller_wifi_ready(void) { return events && (xEventGroupGetBits(events) & BIT0); }

static bool system_credentials(wifi_config_t *station) {
    char ssid[33] = {0}, password[65] = {0};
    esp_err_t err = mosaico_shared_get("wifi_ssid", ssid, sizeof(ssid));
    if (err == ESP_OK) {
        // An explicitly empty shared SSID means the system forgot its network.
        if (!ssid[0]) return false;
        err = mosaico_shared_get("wifi_password", password, sizeof(password));
        if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) return false;
        credential_source = "system_shared";
    } else if (err == ESP_ERR_NVS_NOT_FOUND) {
        nvs_handle_t nvs;
        if (nvs_open_from_partition("sysmeta", "wifi", NVS_READONLY, &nvs) == ESP_OK) {
            size_t n = sizeof(ssid); err = nvs_get_str(nvs, "ssid", ssid, &n);
            n = sizeof(password);
            if (err == ESP_OK) err = nvs_get_str(nvs, "password", password, &n);
            nvs_close(nvs);
            if (err == ESP_OK && ssid[0]) credential_source = "system_legacy";
        }
        if (!ssid[0]) {
            // ESP-IDF's existing station record is another platform source.
            if (esp_wifi_get_config(WIFI_IF_STA, station) == ESP_OK && station->sta.ssid[0]) {
                credential_source = "system_station"; return true;
            }
            return false;
        }
    } else return false;
    memcpy(station->sta.ssid, ssid, strlen(ssid));
    memcpy(station->sta.password, password, strlen(password));
    memset(password, 0, sizeof(password));
    return true;
}

static void wifi_event(void *unused, esp_event_base_t base, int32_t id, void *data) {
    (void)unused; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) (void)esp_wifi_connect();
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(events, BIT0); controller_connected(false);
        (void)esp_wifi_connect();
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(events, BIT0);
        ESP_LOGI("handpad", "system Wi-Fi connected");
    }
}

void controller_wifi_start(void) {
    events = xEventGroupCreate(); configASSERT(events);
    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t loop = esp_event_loop_create_default();
    ESP_ERROR_CHECK(loop == ESP_ERR_INVALID_STATE ? ESP_OK : loop);
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT(); ESP_ERROR_CHECK(esp_wifi_init(&init));
    wifi_config_t station = {0};
    bool configured = system_credentials(&station);
    // Never overwrite system credentials, create an AP, or ask for a host.
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    if (!configured) {
        controller_ui_notice("system_wifi_missing");
        ESP_LOGW("handpad", "No system Wi-Fi record; use Vibe Mode settings"); return;
    }
    station.sta.pmf_cfg.capable = true;
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &station));
    memset(&station, 0, sizeof(station));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
    esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    sntp.start = false; sntp.server_from_dhcp = false;
    ESP_ERROR_CHECK(esp_netif_sntp_init(&sntp));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI("handpad", "Using %s Wi-Fi credentials", credential_source);
}
