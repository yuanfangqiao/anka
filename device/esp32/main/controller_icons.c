/* Vector icons: no external raster assets on the 480x480 screen. */
#include "lvgl.h"
#include <stdint.h>

static void line(lv_obj_t *parent, const int8_t *xy, unsigned count) {
    lv_point_precise_t *points = lv_malloc(count * sizeof(*points));
    if (!points) return;
    for (unsigned i = 0; i < count; i++) { points[i].x = xy[i*2]*3; points[i].y = xy[i*2+1]*3; }
    lv_obj_t *object = lv_line_create(parent);
    lv_line_set_points(object, points, count);
    lv_obj_set_style_line_color(object, lv_color_hex(0xf0d49b), 0);
    lv_obj_set_style_line_width(object, 4, 0);
    lv_obj_set_style_line_rounded(object, true, 0);
    // Objects live for the complete firmware UI lifetime.
}
void controller_icon(lv_obj_t *parent, int index) {
    lv_obj_t *box = lv_obj_create(parent);
    lv_obj_remove_style_all(box); lv_obj_set_size(box, 76, 76);
    lv_obj_center(box);
    lv_obj_remove_flag(box, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    static const int8_t a[][26] = {
        {10,2,14,2,16,9,16,22,8,22,8,9,10,2},
        {2,9,16,9,16,15,6,15,2,12,2,9},
        {10,7,15,8,19,12,19,18,15,23,7,22,3,17,4,11,10,7},
        {12,2,22,6,21,15,17,20,12,24,7,20,3,15,2,6,12,2},
        {4,12,10,8,15,8,18,12,23,10},
        {9,2,15,2,15,9,22,9,22,15,15,15,15,22,9,22,9,15,2,15,2,9,9,9,9,2},
        {3,10,5,5,10,2,16,3,21,7,23,13,21,19,16,23,10,22,5,19},
        {12,2,23,7,23,19,12,24,1,19,1,7,12,2,12,12,23,7},
        {14,8,9,14,16,17,21,23},
    };
    const unsigned counts[] = {7,6,9,9,5,13,10,9,4};
    line(box, a[index], counts[index]);
    static const int8_t rifle[] = {16,11,24,11};
    static const int8_t leg[] = {15,8,11,15,16,18,14,24};
    static const int8_t rear_leg[] = {11,15,5,22};
    static const int8_t crouch[] = {9,14,4,18,12,19,10,24};
    static const int8_t cube[] = {1,7,12,12,12,24};
    static const int8_t cap[] = {12,7,14,2,20,4,18,9};
    if (index == 1) line(box, rifle, 2);
    if (index == 2) line(box, cap, 4);
    if (index == 4) { line(box, leg, 4); line(box, rear_leg, 2); }
    if (index == 7) line(box, cube, 3);
    if (index == 8) line(box, crouch, 4);
    if (index == 4 || index == 8) {
        lv_obj_t *head = lv_obj_create(box); lv_obj_remove_style_all(head);
        lv_obj_set_size(head, 12, 12); lv_obj_set_pos(head, 36, 0);
        lv_obj_set_style_radius(head, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(head, lv_color_hex(0xf0d49b), 0);
        lv_obj_set_style_bg_opa(head, LV_OPA_COVER, 0);
        lv_obj_remove_flag(head, LV_OBJ_FLAG_CLICKABLE);
    }
}
