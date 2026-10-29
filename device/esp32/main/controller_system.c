#include "controller.h"
#include <stdatomic.h>
#include "bsp/esp_mosaico.h"
#include "iris_ota_support.h"
#include "esp_log.h"
#include "freertos/task.h"

static atomic_bool exiting;
bool controller_exiting(void) { return atomic_load(&exiting); }
static void leave(void *unused) {
    (void)unused;
    controller_release(); controller_scan_cancel();
    for (unsigned i=0; i<10 && controller_scan_active(); i++) vTaskDelay(pdMS_TO_TICKS(100));
    // Let the input connection close and release held states before switching.
    vTaskDelay(pdMS_TO_TICKS(180));
    esp_err_t err=iris_ota_support_enter_recovery();
    if (err!=ESP_OK) { ESP_LOGE("handpad", "Return to Vibe failed: %s",esp_err_to_name(err)); atomic_store(&exiting,false); }
    vTaskDelete(NULL);
}
void controller_exit(void) {
    if (!atomic_exchange(&exiting,true) && xTaskCreate(leave,"handpad_exit",4096,NULL,5,NULL)!=pdPASS)
        atomic_store(&exiting,false);
}
static void ai_click(void *button, void *unused) {
    (void)button;(void)unused;
    if(!controller_session_locked())controller_exit();
}
void controller_system_start(void) {
    button_handle_t buttons[BSP_BUTTON_NUM]={0}; int count=0;
    ESP_ERROR_CHECK(bsp_iot_button_create(buttons,&count,BSP_BUTTON_NUM));
    ESP_ERROR_CHECK(iot_button_register_cb(buttons[BSP_BUTTON_AI],BUTTON_SINGLE_CLICK,NULL,ai_click,NULL));
}
