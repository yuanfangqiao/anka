#pragma once
#include "lvgl.h"
#include "pairing.h"
void controller_scan_ui_init(lv_obj_t *screen);
void controller_scan_ui_refresh(pair_status_t status, uint32_t now, bool connected);
