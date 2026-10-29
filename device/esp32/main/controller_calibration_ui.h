#pragma once
#include "lvgl.h"
void controller_calibration_ui_init(lv_obj_t *screen);
void controller_calibration_ui_refresh(uint32_t now,bool connected);
