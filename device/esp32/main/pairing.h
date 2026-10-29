#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef enum { PAIR_SCAN, PAIR_FOUND, PAIR_CONNECTING, PAIR_WIFI, PAIR_CONNECTED, PAIR_ERROR } pair_stage_t;
typedef enum { PAIR_OK, PAIR_BAD_QR, PAIR_LOCALHOST, PAIR_LINK_FAILED, PAIR_EXPIRED, PAIR_CAMERA, PAIR_CLOCK, PAIR_PAUSED, PAIR_GAME_CLOSED, PAIR_UNBOUND } pair_error_t;
typedef struct { pair_stage_t stage; pair_error_t error; uint32_t generation, changed_ms; } pair_status_t;
pair_status_t controller_pair_status(void);
uint32_t controller_pair_reset(void);
bool controller_pair_update(uint32_t generation, pair_stage_t stage, pair_error_t error);
const char *controller_pair_label(pair_status_t status);
