#include "controller.h"
#include "bsp/esp_mosaico.h"
#include "nvs_flash.h"
#include "esp_iris.h"
#include "iris_ota_support.h"

void app_main(void) {
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_iris_boot_probe());
    esp_err_t err = nvs_flash_init();
    iris_ota_support_start();
    // Never erase all existing Vibe/Recovery settings on a migration error.
    if (err != ESP_OK) { return; }
    controller_init();
    ESP_ERROR_CHECK(bsp_power_init());
    ESP_ERROR_CHECK(bsp_power_set_vcc_3v3(true));
    controller_ui_init();
    controller_debug_start();
    controller_system_start();
    controller_wifi_start();
    controller_sensors_start();
    controller_link_start();
    controller_scan_start();
}
