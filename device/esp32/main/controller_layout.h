#pragma once
/* Native panel orientation is 90 degrees away from the normal playing grip. */
#define ANKA_CONTROLLER_ROTATION 900
static inline void anka_controller_point(int panel_x,int panel_y,int *x,int *y) {
    *x=panel_y;*y=480-panel_x;
}
