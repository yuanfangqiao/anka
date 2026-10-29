/* Camera conversion follows the pinned Mosaico camera_lcd_preview example.
 * Upstream example: Espressif Systems (Shanghai) CO LTD, Apache-2.0. */
#include "controller_camera.h"
#include "esp_cache.h"
#include "esp_heap_caps.h"
#include <stdlib.h>

esp_err_t controller_camera_init(controller_camera_t *camera) {
    camera->bytes=(ANKA_PREVIEW_SIZE*ANKA_PREVIEW_SIZE*2+127)&~127U;
    camera->rgb=heap_caps_aligned_calloc(128,1,camera->bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_DMA|MALLOC_CAP_8BIT);
    if (!camera->rgb) return ESP_ERR_NO_MEM;
    ppa_client_config_t config={.oper_type=PPA_OPERATION_SRM,.max_pending_trans_num=1};
    return ppa_register_client(&config,&camera->ppa);
}
esp_err_t controller_camera_frame(controller_camera_t *camera, const mosaico_camera_frame_t *frame, uint8_t *gray) {
    anka_camera_crop_t crop;
    if (!frame->data || frame->pixel_format!=V4L2_PIX_FMT_UYVY) return ESP_ERR_NOT_SUPPORTED;
    if (!anka_camera_crop(frame->width,frame->height,frame->bytes_per_line,frame->size,&crop)) return ESP_ERR_INVALID_SIZE;
    // DVP writes PSRAM via DMA. CPU decoding MUST invalidate the cached view.
    esp_err_t err=esp_cache_msync((void*)frame->data,frame->size,
        ESP_CACHE_MSYNC_FLAG_DIR_M2C|ESP_CACHE_MSYNC_FLAG_INVALIDATE);
    if (err!=ESP_OK) return err;
    if(gray)anka_camera_luma(frame->data,&crop,gray);
    err=esp_cache_msync(camera->rgb,camera->bytes,ESP_CACHE_MSYNC_FLAG_DIR_C2M);
    if (err!=ESP_OK) return err;
    ppa_srm_oper_config_t operation={
        .in={.buffer=frame->data,.pic_w=crop.stride/2,.pic_h=frame->height,
             .block_w=crop.size,.block_h=crop.size,.block_offset_x=crop.x,.block_offset_y=crop.y,
             .srm_cm=PPA_SRM_COLOR_MODE_YUV422_UYVY,.yuv_range=PPA_COLOR_RANGE_LIMIT,
             .yuv_std=PPA_COLOR_CONV_STD_RGB_YUV_BT601},
        .out={.buffer=camera->rgb,.buffer_size=camera->bytes,.pic_w=ANKA_PREVIEW_SIZE,
              .pic_h=ANKA_PREVIEW_SIZE,.srm_cm=PPA_SRM_COLOR_MODE_RGB565},
        .rotation_angle=PPA_SRM_ROTATION_ANGLE_90,.scale_x=0.5625f,.scale_y=0.5625f,
        .mirror_y=false,.mirror_x=false,.mode=PPA_TRANS_MODE_BLOCKING,
    };
    err=ppa_do_scale_rotate_mirror(camera->ppa,&operation);
    if (err!=ESP_OK) return err;
    return esp_cache_msync(camera->rgb,camera->bytes,
        ESP_CACHE_MSYNC_FLAG_DIR_M2C|ESP_CACHE_MSYNC_FLAG_INVALIDATE);
}
void controller_camera_deinit(controller_camera_t *camera) {
    if (camera->ppa) ppa_unregister_client(camera->ppa);
    free(camera->rgb);*camera=(controller_camera_t){0};
}
