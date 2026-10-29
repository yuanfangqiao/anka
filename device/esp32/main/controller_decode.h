#pragma once
#include <stdbool.h>
#include <stdint.h>
bool controller_decode_start(void);
uint8_t *controller_decode_buffer(void);
void controller_decode_submit(uint8_t *gray, uint32_t generation);
/* USB QA owns one queued image until the final chunk; never touches the camera. */
unsigned controller_decode_capture(uint32_t offset, uint8_t *out, unsigned cap);
