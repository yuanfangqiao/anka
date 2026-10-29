#pragma once
#include "camera_pixels.h"
#include "driver/ppa.h"
#include "mosaico_module_camera.h"

typedef struct { ppa_client_handle_t ppa; uint16_t *rgb; size_t bytes; } controller_camera_t;
esp_err_t controller_camera_init(controller_camera_t *camera);
esp_err_t controller_camera_frame(controller_camera_t *camera, const mosaico_camera_frame_t *frame, uint8_t *gray);
void controller_camera_deinit(controller_camera_t *camera);
