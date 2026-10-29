#include "camera_pixels.h"

bool anka_camera_crop(uint32_t width, uint32_t height, uint32_t stride,
                      size_t bytes, anka_camera_crop_t *crop) {
    if (!crop || width < ANKA_SCAN_SIZE || height < ANKA_SCAN_SIZE ||
        width > 4096 || height > 4096 || (width & 1)) return false;
    if (!stride) stride = width * 2;
    if ((stride & 1) || stride < width * 2 || stride > bytes / height) return false;
    *crop = (anka_camera_crop_t){.x=((width-ANKA_SCAN_SIZE)/2)&~1U,
        .y=((height-ANKA_SCAN_SIZE)/2)&~1U, .size=ANKA_SCAN_SIZE, .stride=stride};
    return true;
}
void anka_camera_luma(const uint8_t *uyvy, const anka_camera_crop_t *crop, uint8_t *gray) {
    // U Y0 V Y1: keep every luma sample in the same square shown in preview.
    for (uint32_t y=0; y<crop->size; y++) {
        const uint8_t *row=uyvy+(size_t)(y+crop->y)*crop->stride+crop->x*2;
        for (uint32_t x=0; x<crop->size; x++) gray[y*crop->size+x]=row[x*2+1];
    }
}
