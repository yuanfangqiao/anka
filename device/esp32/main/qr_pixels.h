#pragma once
#include <stdbool.h>
#include <stdint.h>
/* Source is a stable 640-square luma image. Supported outputs: 320/480/640. */
void anka_qr_pixels(const uint8_t *source,uint8_t *out,unsigned size,bool reverse);
