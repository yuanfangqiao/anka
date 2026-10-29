#pragma once
#include <stdbool.h>
#include <stdint.h>
#define ANKA_GESTURE_CELL 152.f
#define ANKA_GESTURE_TURN_GATE (ANKA_GESTURE_CELL*.5f)
#define ANKA_GESTURE_TURN_DEGREES 180.f
typedef struct {
    float start_x, start_y, x, y, move_x, move_y, max_distance, max_vertical, turn_angle, turn_delta, turn_progress, turn_anchor;
    int action, turn_direction;
    uint32_t started;
    bool pressed, dragging, turn_blocked, turn_active;
} anka_gesture_t;
void anka_gesture_down(anka_gesture_t *g, float x, float y, int action, uint32_t now);
void anka_gesture_move(anka_gesture_t *g, float x, float y);
int anka_gesture_up(anka_gesture_t *g, float x, float y, int action, uint32_t now);
void anka_gesture_cancel(anka_gesture_t *g);
