#include "controller.h"
#include "controller_scan_ui.h"
#include "camera_pixels.h"
#include "bsp/esp_mosaico.h"
#include "esp_heap_caps.h"
#include "freertos/semphr.h"
#include <stdatomic.h>
#include <string.h>
#include <stdlib.h>
#include "esp_timer.h"

static lv_obj_t *box,*preview,*label,*indicator,*check,*corner_lines[4];
static uint16_t *pixels;
static uint16_t *mailbox;
static SemaphoreHandle_t mailbox_lock;
static bool mailbox_ready;
static atomic_uint displayed;
uint32_t controller_ui_preview_frames(void){return atomic_load(&displayed);}
static int last_stage=-1,last_error=-1;
static void line(lv_obj_t *parent,const lv_point_precise_t *p,int n,int x,int y,lv_color_t color) {
    lv_obj_t *obj=lv_line_create(parent);lv_line_set_points(obj,p,n);lv_obj_set_pos(obj,x,y);
    lv_obj_set_style_line_color(obj,color,0);lv_obj_set_style_line_width(obj,3,0);
    lv_obj_set_style_line_rounded(obj,true,0);lv_obj_remove_flag(obj,LV_OBJ_FLAG_CLICKABLE);
}
static void retry(lv_event_t *event){(void)event;controller_scan_start();}
void controller_scan_ui_init(lv_obj_t *screen) {
    box=lv_obj_create(screen);lv_obj_remove_style_all(box);lv_obj_set_pos(box,0,24);lv_obj_set_size(box,480,432);
    lv_obj_set_style_bg_color(box,lv_color_hex(0x07131f),0);lv_obj_set_style_bg_opa(box,LV_OPA_COVER,0);
    lv_obj_remove_flag(box,LV_OBJ_FLAG_SCROLLABLE);lv_obj_add_flag(box,LV_OBJ_FLAG_PRESS_LOCK);
    const size_t bytes=ANKA_PREVIEW_SIZE*ANKA_PREVIEW_SIZE*2;
    pixels=heap_caps_calloc(1,bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    mailbox=heap_caps_malloc(bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);mailbox_lock=xSemaphoreCreateMutex();
    configASSERT(pixels&&mailbox&&mailbox_lock);
    preview=lv_canvas_create(box);lv_canvas_set_buffer(preview,pixels,ANKA_PREVIEW_SIZE,ANKA_PREVIEW_SIZE,LV_COLOR_FORMAT_RGB565);
    lv_obj_align(preview,LV_ALIGN_TOP_MID,0,6);lv_obj_remove_flag(preview,LV_OBJ_FLAG_CLICKABLE);
    static const lv_point_precise_t corners[][3]={{{0,32},{0,0},{32,0}},{{0,0},{32,0},{32,32}},{{0,0},{0,32},{32,32}},{{0,32},{32,32},{32,0}}};
    for(int i=0;i<4;i++){
        corner_lines[i]=lv_line_create(box);lv_line_set_points(corner_lines[i],corners[i],3);
        lv_obj_set_pos(corner_lines[i],i%2?390:58,i/2?336:4);
        lv_obj_set_style_line_width(corner_lines[i],3,0);lv_obj_remove_flag(corner_lines[i],LV_OBJ_FLAG_CLICKABLE);
    }
    label=lv_label_create(box);lv_obj_set_pos(label,108,384);lv_obj_set_width(label,280);
    lv_obj_set_style_text_font(label,&lv_font_montserrat_20,0);lv_obj_set_style_text_color(label,lv_color_hex(0xc3d6df),0);
    lv_obj_remove_flag(label,LV_OBJ_FLAG_CLICKABLE);
    indicator=lv_arc_create(box);lv_obj_set_size(indicator,34,34);lv_obj_set_pos(indicator,62,376);
    lv_obj_remove_style(indicator,NULL,LV_PART_KNOB);lv_obj_remove_flag(indicator,LV_OBJ_FLAG_CLICKABLE);
    lv_arc_set_bg_angles(indicator,0,360);lv_arc_set_angles(indicator,0,70);
    lv_obj_set_style_arc_width(indicator,3,LV_PART_MAIN);lv_obj_set_style_arc_opa(indicator,LV_OPA_20,LV_PART_MAIN);
    lv_obj_set_style_arc_width(indicator,3,LV_PART_INDICATOR);
    check=lv_obj_create(box);lv_obj_remove_style_all(check);lv_obj_set_size(check,38,38);lv_obj_set_pos(check,60,374);
    lv_obj_remove_flag(check,LV_OBJ_FLAG_CLICKABLE);
    static const lv_point_precise_t tick[]={{0,15},{11,26},{32,3}};
    line(check,tick,3,0,0,lv_color_hex(0x73ff83));
    lv_obj_t *button=lv_button_create(box);lv_obj_set_size(button,48,44);lv_obj_set_pos(button,402,372);
    lv_obj_add_event_cb(button,retry,LV_EVENT_CLICKED,NULL);
    static const lv_point_precise_t circle[]={{27,9},{23,3},{10,3},{3,10},{3,23},{11,30},{24,30},{30,23}},head[]={{18,9},{28,10},{28,0}};
    line(button,circle,8,-7,-7,lv_color_hex(0xf0d49b));line(button,head,3,-7,-7,lv_color_hex(0xf0d49b));
}
void controller_scan_ui_refresh(pair_status_t s,uint32_t now,bool connected) {
    // Only the LVGL task touches canvas objects. Capture publishes the latest
    // pixels without entering LVGL's image/cache locks from a second thread.
    if(xSemaphoreTake(mailbox_lock,0)==pdTRUE){
        if(mailbox_ready){memcpy(pixels,mailbox,ANKA_PREVIEW_SIZE*ANKA_PREVIEW_SIZE*2);mailbox_ready=false;
            lv_obj_invalidate(preview);atomic_fetch_add(&displayed,1);}
        xSemaphoreGive(mailbox_lock);
    }
    (void)connected;
    bool hidden=controller_session_locked();
    if(hidden){lv_obj_add_flag(box,LV_OBJ_FLAG_HIDDEN);return;}
    lv_obj_remove_flag(box,LV_OBJ_FLAG_HIDDEN);
    if(last_stage!=(int)s.stage||last_error!=(int)s.error){
        lv_label_set_text(label,controller_pair_label(s));last_stage=s.stage;last_error=s.error;
        lv_color_t color=lv_color_hex(s.stage==PAIR_ERROR?0xff6575:(s.stage==PAIR_FOUND||s.stage==PAIR_CONNECTED)?0x73ff83:0xf0d49b);
        for(int i=0;i<4;i++)lv_obj_set_style_line_color(corner_lines[i],color,0);
        lv_obj_set_style_text_color(label,color,0);lv_obj_set_style_arc_color(indicator,color,LV_PART_INDICATOR);
        bool done=s.stage==PAIR_FOUND||s.stage==PAIR_CONNECTED;
        if(done){lv_obj_remove_flag(check,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(indicator,LV_OBJ_FLAG_HIDDEN);}
        else{lv_obj_add_flag(check,LV_OBJ_FLAG_HIDDEN);lv_obj_remove_flag(indicator,LV_OBJ_FLAG_HIDDEN);}
    }
    // Animate only the connection phase; scanning redraws at camera frame rate.
    if(s.stage==PAIR_CONNECTING||s.stage==PAIR_WIFI)lv_arc_set_rotation(indicator,(now/5)%360);
}
void controller_ui_preview(const uint16_t *rgb,int width,int height) {
    if(width!=ANKA_PREVIEW_SIZE||height!=ANKA_PREVIEW_SIZE||!mailbox_lock)return;
    if(xSemaphoreTake(mailbox_lock,0)!=pdTRUE)return;
    memcpy(mailbox,rgb,width*height*2);mailbox_ready=true;xSemaphoreGive(mailbox_lock);
}
