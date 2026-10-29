#include "controller.h"
#include "gesture.h"
#include "controller_layout.h"
#include "controller_calibration_ui.h"
#include "controller_trace.h"
#include "controller_scan_ui.h"
#include <string.h>
#include <stdatomic.h>
#include "bsp/esp_mosaico.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "lvgl.h"

void controller_icon(lv_obj_t *parent, int index);
static lv_obj_t *jump, *warning, *handpad;
static atomic_bool handpad_visible;
bool controller_ui_handpad_visible(void){return atomic_load(&handpad_visible);}
static portMUX_TYPE ui_lock=portMUX_INITIALIZER_UNLOCKED;
static uint32_t notice_until;
static bool reset_touch;
static anka_gesture_t gesture;
static uint32_t now_ms(void) { return esp_timer_get_time()/1000; }
void controller_ui_reset_touch(void) {
    portENTER_CRITICAL(&ui_lock); reset_touch=true; portEXIT_CRITICAL(&ui_lock);
}
static void reset_gesture(void) {
    portENTER_CRITICAL(&ui_lock); bool reset=reset_touch; reset_touch=false; portEXIT_CRITICAL(&ui_lock);
    if (reset) { anka_gesture_cancel(&gesture); controller_trace_up(now_ms(),true); }
}
static int hit(int x,int y) {
    if(x<12||x>=468||y<30||y>=450)return -1;
    return ((y-30)/140)*3+(x-12)/152;
}
static void track(lv_point_t p) {
    anka_gesture_move(&gesture,p.x,p.y);controller_move(gesture.move_x,gesture.move_y);controller_turn(gesture.turn_delta);
    controller_trace_move(p.x,p.y,gesture.dragging&&gesture.action==4);
    controller_trace_turn(gesture.dragging&&gesture.action>=0&&gesture.action<3&&!gesture.turn_blocked,
        gesture.turn_progress,gesture.turn_active,gesture.turn_direction,
        gesture.turn_active?gesture.turn_anchor:gesture.turn_direction*ANKA_GESTURE_TURN_GATE);
}
static void touch(lv_event_t *event) {
    reset_gesture();
    lv_event_code_t code=lv_event_get_code(event); lv_indev_t *input=lv_indev_active();
    if(!input||controller_exiting())return;
    lv_point_t p;lv_indev_get_point(input,&p);
    int x,y;anka_controller_point(p.x,p.y,&x,&y);p.x=x;p.y=y;uint32_t now=now_ms();
    if(code==LV_EVENT_PRESSED){anka_gesture_down(&gesture,p.x,p.y,hit(p.x,p.y),now);controller_trace_down(p.x,p.y,now);}
    else if(code==LV_EVENT_PRESSING){track(p);}
    else if(code==LV_EVENT_RELEASED){
        track(p);controller_trace_up(now,false);
        int action=anka_gesture_up(&gesture,p.x,p.y,hit(p.x,p.y),now);controller_move(0,0);
        controller_action(action);
    }else if(code==LV_EVENT_PRESS_LOST){anka_gesture_cancel(&gesture);controller_move(0,0);controller_trace_up(now,true);}
}
static void line(lv_obj_t *parent,const lv_point_precise_t *points,unsigned count,int x,int y,lv_color_t color) {
    lv_obj_t *obj=lv_line_create(parent);lv_line_set_points(obj,points,count);lv_obj_set_pos(obj,x,y);
    lv_obj_set_style_line_width(obj,3,0);lv_obj_set_style_line_color(obj,color,0);lv_obj_set_style_line_rounded(obj,true,0);
    lv_obj_remove_flag(obj,LV_OBJ_FLAG_CLICKABLE);
}
static void refresh(lv_timer_t *timer) {
    (void)timer;reset_gesture();controller_trace_tick(now_ms());
    controller_state_t state=controller_snapshot(false);
    pair_status_t pair=controller_pair_status();
    controller_calibration_status_t calibration=controller_calibration_status();
    bool show=calibration.pose.bound&&calibration.pose.phase==CAL_READY&&now_ms()-calibration.pose.ready_at>=350;
    if(show)lv_obj_remove_flag(handpad,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(handpad,LV_OBJ_FLAG_HIDDEN);
    atomic_store(&handpad_visible,show);
    lv_color_t color=lv_color_hex(state.connected?0x73ff83:0xff5565);
    static int last_connection=-1;
    if(last_connection!=(int)state.connected){lv_obj_set_style_border_color(jump,color,0);lv_obj_set_style_shadow_color(jump,color,0);last_connection=state.connected;}
    portENTER_CRITICAL(&ui_lock);uint32_t until=notice_until;portEXIT_CRITICAL(&ui_lock);
    controller_scan_ui_refresh(pair,now_ms(),state.connected);
    controller_calibration_ui_refresh(now_ms(),state.connected);
    if(now_ms()<until)lv_obj_remove_flag(warning,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(warning,LV_OBJ_FLAG_HIDDEN);
}
void controller_ui_init(void) {
    lv_display_t *display=bsp_display_start();configASSERT(display);configASSERT(bsp_display_lock(-1));
    lv_display_set_render_mode(display,LV_DISPLAY_RENDER_MODE_FULL);
    lv_obj_t *screen=lv_screen_active();lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_color(screen,lv_color_hex(0x07131f),0);lv_obj_set_style_bg_opa(screen,LV_OPA_COVER,0);
    lv_obj_remove_flag(screen,LV_OBJ_FLAG_SCROLLABLE);
    handpad=lv_obj_create(screen);lv_obj_remove_style_all(handpad);lv_obj_set_size(handpad,480,480);
    lv_obj_remove_flag(handpad,LV_OBJ_FLAG_CLICKABLE|LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_transform_pivot_x(handpad,240,0);lv_obj_set_style_transform_pivot_y(handpad,240,0);
    lv_obj_set_style_transform_rotation(handpad,ANKA_CONTROLLER_ROTATION,0);
    for(int i=0;i<9;i++){
        lv_obj_t *button=lv_button_create(handpad);lv_obj_remove_style_all(button);
        lv_obj_set_pos(button,12+(i%3)*152,30+(i/3)*140);lv_obj_set_size(button,150,138);
        lv_obj_set_style_radius(button,i==4?LV_RADIUS_CIRCLE:18,0);
        lv_obj_set_style_bg_color(button,lv_color_hex(0x122735),0);lv_obj_set_style_bg_opa(button,LV_OPA_COVER,0);
        lv_obj_set_style_bg_grad_dir(button,LV_GRAD_DIR_NONE,0);
        lv_obj_set_style_bg_color(button,lv_color_hex(0x29414f),LV_STATE_PRESSED);
        lv_obj_set_style_border_width(button,i==4?3:1,0);lv_obj_set_style_border_color(button,lv_color_hex(0x506373),0);
        lv_obj_set_style_shadow_width(button,i==4?16:0,0);
        lv_obj_add_flag(button,LV_OBJ_FLAG_PRESS_LOCK);lv_obj_remove_flag(button,LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(button,touch,LV_EVENT_ALL,NULL);controller_icon(button,i);if(i==4)jump=button;
    }
    controller_trace_init(handpad);
    controller_scan_ui_init(screen);
    controller_calibration_ui_init(screen);
    warning=lv_obj_create(screen);lv_obj_remove_style_all(warning);lv_obj_set_size(warning,24,24);lv_obj_set_pos(warning,438,4);
    static const lv_point_precise_t triangle[]={{12,0},{24,23},{0,23},{12,0}},mark[]={{12,7},{12,14}};
    line(warning,triangle,4,0,0,lv_color_hex(0xffc766));line(warning,mark,2,0,0,lv_color_hex(0xffc766));
    lv_timer_create(refresh,20,NULL);refresh(NULL);bsp_display_unlock();
}
void controller_ui_notice(const char *text) {
    (void)text;portENTER_CRITICAL(&ui_lock);notice_until=now_ms()+3000;portEXIT_CRITICAL(&ui_lock);
}
