#include "gesture.h"
#include <math.h>
#include <string.h>
void anka_gesture_cancel(anka_gesture_t *g) { memset(g, 0, sizeof(*g)); }
void anka_gesture_down(anka_gesture_t *g, float x, float y, int action, uint32_t now) {
    anka_gesture_cancel(g);
    g->start_x = x; g->start_y = y; g->action = action; g->started = now; g->pressed = true;
}
void anka_gesture_move(anka_gesture_t *g, float x, float y) {
    if (!g->pressed) return;
    float dx = x - g->start_x, dy = y - g->start_y, distance = hypotf(dx, dy);
    g->turn_delta=0;g->max_vertical=fmaxf(g->max_vertical,fabsf(dy));
    g->max_distance = fmaxf(g->max_distance, distance);
    if (g->max_distance >= 10) g->dragging = true;
    if (g->dragging && g->action==4) {
        float scale = fmaxf(100, distance);
        g->move_x = dx / scale; g->move_y = -dy / scale;
    }
    if(g->dragging&&g->action>=0&&g->action<3){
        if(g->max_vertical>ANKA_GESTURE_CELL*.5f)g->turn_blocked=true;
        if(!g->turn_blocked){
            if(!g->turn_active&&fabsf(dx)>ANKA_GESTURE_TURN_GATE){
                g->turn_active=true;g->turn_anchor=copysignf(ANKA_GESTURE_TURN_GATE,dx);
            }
            g->turn_progress=g->turn_active?1:fminf(1,fabsf(dx)/ANKA_GESTURE_TURN_GATE);
            float angle=g->turn_active?(dx-g->turn_anchor)*ANKA_GESTURE_TURN_DEGREES/ANKA_GESTURE_CELL:0;
            g->turn_delta=angle-g->turn_angle;g->turn_angle=angle;
            if(g->turn_delta)g->turn_direction=g->turn_delta<0?-1:1;
            else if(!g->turn_active)g->turn_direction=dx<0?-1:1;
        }
    }
    g->x = x; g->y = y;
}
int anka_gesture_up(anka_gesture_t *g, float x, float y, int action, uint32_t now) {
    anka_gesture_move(g, x, y);
    int result = g->pressed && !g->dragging && action == g->action &&
                 now - g->started <= 350 ? action : -1;
    anka_gesture_cancel(g);
    return result;
}
