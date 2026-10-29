#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define ANKA_SCAN_SIZE 640
#define ANKA_PREVIEW_SIZE 360
typedef struct { uint32_t x, y, size, stride; } anka_camera_crop_t;
bool anka_camera_crop(uint32_t width, uint32_t height, uint32_t stride,
                      size_t bytes, anka_camera_crop_t *crop);
void anka_camera_luma(const uint8_t *uyvy, const anka_camera_crop_t *crop, uint8_t *gray);
