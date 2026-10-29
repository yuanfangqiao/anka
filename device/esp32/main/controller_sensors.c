#include "controller.h"
#include <math.h>
#include "bsp/esp_mosaico.h"
#include "mosaico_module_interact.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/task.h"

static portMUX_TYPE output_lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t motor_until;
static uint8_t motor_strength;

void controller_feedback(float strength, uint32_t duration_ms) {
    portENTER_CRITICAL(&output_lock);
    motor_strength = (uint8_t)(fmaxf(0, fminf(.6f, strength)) * 100);
    motor_until = (uint32_t)(esp_timer_get_time() / 1000) + (duration_ms > 150 ? 150 : duration_ms);
    portEXIT_CRITICAL(&output_lock);
}

static void sensors(void *unused) {
    (void)unused;
    (void)bsp_motor_init();
    mosaico_interact_handle_t buttons = NULL;
    mosaico_interact_config_t config = MOSAICO_INTERACT_DEFAULT_CONFIG();
    config.discovery_timeout_ms = 1000;
    // These are mechanical key-to-GND switches, not finger touch pads.
    config.button_mode=MOSAICO_INTERACT_BUTTON_MODE_GPIO;
    int raw_mask = 0, stable_mask = 0;
    uint32_t retry = 0, changed = 0, led_time = 0;
    TickType_t wake = xTaskGetTickCount();
    while (true) {
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
        if (!buttons && now >= retry) {
            esp_err_t error=mosaico_interact_open(&config,&buttons);
            controller_calibration_module(error==ESP_OK,error,0);
            if(error!=ESP_OK)buttons=NULL;
            else ESP_LOGI("handpad","Interaction board ready: mechanical GPIO keys");
            retry = now + 1000;
        }
        if (buttons) {
            mosaico_interact_inputs_t value = {0};
            esp_err_t error=mosaico_interact_read_inputs(buttons,&value);
            if (error == ESP_OK) {
                int next = (value.right_pressed ? 1 : 0) | (value.left_pressed ? 2 : 0);
                if (next != raw_mask) { raw_mask = next; changed = now; }
                if (now - changed >= 6) stable_mask = raw_mask;
                controller_calibration_module(true,ESP_OK,stable_mask);
                controller_buttons(stable_mask&2,stable_mask&1);
            } else {
                controller_release(); (void)mosaico_interact_close(buttons); buttons = NULL;
                stable_mask = raw_mask = 0; retry = now + 1000;
                controller_calibration_module(false,error,0);
                controller_ui_notice("按键模块断开，请重新插入");
            }
        }
        if (buttons && now-led_time >= 50) {
            controller_state_t state = controller_snapshot(false);
            uint8_t level = state.connected ? 24 : 4;
            mosaico_interact_rgb_t leds[6] = {{0,level,level},{0,level,0},{level,level/2,0},
                {level,level,level},{0},{0}};
            // Physical left=fire and right=aim; SDK key names are opposite on this assembly.
            leds[4]=(mosaico_interact_rgb_t){0,state.aim?32:0,state.aim?32:0};
            leds[5]=(mosaico_interact_rgb_t){state.fire?32:0,state.fire?16:0,0};
            (void)mosaico_interact_led_write(buttons, leds, 6); led_time = now;
        }
        portENTER_CRITICAL(&output_lock);
        uint8_t strength = now < motor_until ? motor_strength : 0;
        portEXIT_CRITICAL(&output_lock);
        (void)bsp_motor_set_strength(strength);
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(5));
    }
}
void controller_sensors_start(void) {
    controller_motion_start();
    configASSERT(xTaskCreate(sensors,"controller_sensors",6144,NULL,4,NULL)==pdPASS);
}
