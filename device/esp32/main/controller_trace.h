#pragma once
#include "lvgl.h"
void controller_trace_init(lv_obj_t *parent);
void controller_trace_down(int x, int y, uint32_t now);
void controller_trace_move(int x, int y, bool dragging);
void controller_trace_up(uint32_t now, bool cancel);
void controller_trace_tick(uint32_t now);

void controller_trace_turn(bool enabled,float progress,bool active,int direction,float gate_offset);
