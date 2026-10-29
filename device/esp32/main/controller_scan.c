#include "controller.h"
#include "controller_camera.h"
#include "controller_decode.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/task.h"
#include <stdatomic.h>
#include <string.h>

static atomic_bool active,attempted,started,cancelled;
static atomic_uint frames,preview_us;
static atomic_int camera_error;
static portMUX_TYPE accepted_lock=portMUX_INITIALIZER_UNLOCKED;
static uint32_t accepted_generation;
static char accepted_url[1024];
uint32_t controller_scan_frames(void){return atomic_load(&frames);}
uint32_t controller_scan_preview_us(void){return atomic_load(&preview_us);}
int controller_scan_error(void){return atomic_load(&camera_error);}
bool controller_scan_active(void){return atomic_load(&active);}
bool controller_scan_boot_attempted(void){return atomic_load(&attempted);}
void controller_scan_cancel(void){atomic_store(&cancelled,true);pair_status_t s=controller_pair_status();controller_pair_update(s.generation,PAIR_ERROR,PAIR_PAUSED);}

bool controller_scan_accept(const char *url,uint32_t generation) {
    if(controller_session_locked()||controller_exiting())return false;
    pair_status_t status=controller_pair_status();
    if(status.generation!=generation||(status.stage!=PAIR_SCAN&&status.stage!=PAIR_ERROR))return false;
    portENTER_CRITICAL(&accepted_lock);
    bool duplicate=accepted_generation==generation&&!strcmp(accepted_url,url);
    if(!duplicate){accepted_generation=generation;strlcpy(accepted_url,url,sizeof(accepted_url));}
    portEXIT_CRITICAL(&accepted_lock);
    if(duplicate)return false;
    if(!controller_link_join(url)){
        pair_error_t reason=strstr(url,"://localhost")||strstr(url,"://127.")?PAIR_LOCALHOST:PAIR_BAD_QR;
        controller_pair_update(generation,PAIR_ERROR,reason);return false;
    }
    if(!controller_pair_update(generation,PAIR_FOUND,PAIR_OK))return false;
    controller_feedback(.25f,35);
    ESP_LOGI("handpad","QR accepted; starting device connection");return true;
}
static void close_camera(mosaico_camera_handle_t *camera,controller_camera_t *converter){
    if(*camera){(void)mosaico_camera_stop_stream(*camera);(void)mosaico_camera_del(*camera);*camera=NULL;}
    controller_camera_deinit(converter);atomic_store(&active,false);
}
static void capture(void *unused) {
    (void)unused;
    mosaico_camera_handle_t camera=NULL;controller_camera_t converter={0};unsigned failures=0;
    uint32_t last_decode=0;
    while(true){
        pair_status_t status=controller_pair_status();
        if(controller_exiting()||controller_session_locked()||atomic_load(&cancelled)){
            if(camera)close_camera(&camera,&converter);
            vTaskDelay(pdMS_TO_TICKS(40));continue;
        }
        if(!camera){
            mosaico_camera_config_t config=MOSAICO_CAMERA_DEFAULT_CONFIG();config.frame_timeout_ms=350;
            esp_err_t err=controller_camera_init(&converter);
            if(err==ESP_OK)err=mosaico_camera_new(&config,&camera);
            if(err==ESP_OK)err=mosaico_camera_open(camera);
            if(err==ESP_OK)err=mosaico_camera_start_stream(camera);
            atomic_store(&camera_error,err);
            if(err!=ESP_OK){
                close_camera(&camera,&converter);controller_pair_update(status.generation,PAIR_ERROR,PAIR_CAMERA);
                vTaskDelay(pdMS_TO_TICKS(1000));continue;
            }
            atomic_store(&active,true);failures=0;
        }
        mosaico_camera_frame_t frame={0};esp_err_t err=mosaico_camera_get_frame(camera,&frame);
        if(err!=ESP_OK){
            if(err!=ESP_ERR_INVALID_SIZE&&++failures>=3){close_camera(&camera,&converter);failures=0;}
            atomic_store(&camera_error,err);vTaskDelay(pdMS_TO_TICKS(5));continue;
        }
        failures=0;uint32_t now=esp_timer_get_time()/1000;uint8_t *gray=NULL;
        if((status.stage==PAIR_SCAN||status.stage==PAIR_ERROR)&&now-last_decode>=120){gray=controller_decode_buffer();last_decode=now;}
        int64_t start=esp_timer_get_time();err=controller_camera_frame(&converter,&frame,gray);
        (void)mosaico_camera_return_frame(camera,&frame);atomic_store(&camera_error,err);
        if(err==ESP_OK){
            controller_ui_preview(converter.rgb,ANKA_PREVIEW_SIZE,ANKA_PREVIEW_SIZE);
            atomic_fetch_add(&frames,1);atomic_store(&preview_us,esp_timer_get_time()-start);
        }
        controller_decode_submit(gray,err==ESP_OK?status.generation:0);
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
void controller_scan_start(void) {
    if(controller_exiting()||controller_session_locked())return;
    atomic_store(&attempted,true);atomic_store(&cancelled,false);
    controller_link_reset();controller_pair_reset();controller_release();
    if(!atomic_exchange(&started,true)){
        configASSERT(controller_decode_start());
        configASSERT(xTaskCreatePinnedToCore(capture,"camera_preview",6144,NULL,3,NULL,1)==pdPASS);
    }
}
