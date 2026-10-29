set(QUIRC "${CMAKE_CURRENT_LIST_DIR}/../.deps/quirc/lib")
idf_component_register(
    SRCS app_main.c controller.c gesture.c controller_ui.c controller_icons.c controller_wifi.c
         controller_link.c controller_scan.c controller_sensors.c controller_url.c
         navigation.c controller_system.c controller_debug.c
         camera_pixels.c controller_camera.c controller_trace.c
         pairing.c controller_scan_ui.c controller_decode.c qr_pixels.c
         imu_calibration.c controller_calibration.c controller_calibration_ui.c orientation.c controller_motion.c
         "${QUIRC}/quirc.c" "${QUIRC}/decode.c" "${QUIRC}/identify.c" "${QUIRC}/version_db.c"
    INCLUDE_DIRS "." "${QUIRC}"
    REQUIRES esp-mosaico-bsp mosaico_module_interact mosaico_module_camera
             esp_wifi esp_event esp_netif nvs_flash http_parser
             esp_timer esp-tls mbedtls esp_websocket_client cjson esp_iris esp_mosaico_app_recovery
             esp_psram espcoredump esp_driver_ppa esp_mm esp_lvgl_adapter)
target_compile_definitions(${COMPONENT_LIB} PRIVATE QUIRC_FLOAT_TYPE=float QUIRC_USE_TGMATH=1 QUIRC_MAX_REGIONS=1024)
