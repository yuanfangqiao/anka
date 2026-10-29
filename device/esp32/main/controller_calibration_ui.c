#include "controller.h"
#include "controller_layout.h"
#include "controller_calibration.h"
#include "controller_calibration_ui.h"
#include "bsp/esp_mosaico.h"
#include "esp_lv_adapter_input.h"
#include <string.h>
static lv_obj_t *page,*keys[2],*status,*progress;
static int previous_phase=-1,previous_mask=-1,previous_connection=-1;
static esp_err_t read_touch(esp_lcd_touch_handle_t touch,esp_lcd_touch_point_data_t *out,
                            uint8_t *count,uint8_t cap,void *unused) {
    (void)unused;
    esp_lcd_touch_point_data_t points[CONFIG_ESP_LCD_TOUCH_MAX_POINTS]={0};uint8_t n=0;
    esp_err_t err=esp_lcd_touch_read_data(touch);
    if(err==ESP_OK)err=esp_lcd_touch_get_data(touch,points,&n,CONFIG_ESP_LCD_TOUCH_MAX_POINTS);
    unsigned mask=0;
    if(err==ESP_OK)for(unsigned i=0;i<n;i++)mask|=anka_calibration_hit(points[i].x,points[i].y);
    controller_calibration_touch(mask);
    *count=n<cap?n:cap;if(err==ESP_OK)memcpy(out,points,*count*sizeof(*out));return err;
}
static void virtual_key(lv_event_t *event) {
    // Real hardware is sampled as one complete multi-touch snapshot above.
    if(lv_indev_active()==bsp_display_get_input_dev())return;
    unsigned bit=(unsigned)(uintptr_t)lv_event_get_user_data(event);
    lv_event_code_t code=lv_event_get_code(event);
    if(code==LV_EVENT_PRESSED)controller_calibration_virtual_button(bit,true);
    else if(code==LV_EVENT_RELEASED||code==LV_EVENT_PRESS_LOST)controller_calibration_virtual_button(bit,false);
}
static void text(lv_obj_t *parent,const char *value,int y,const lv_font_t *font) {
    lv_obj_t *label=lv_label_create(parent);lv_label_set_text(label,value);
    lv_obj_set_style_text_font(label,font,0);lv_obj_set_style_text_color(label,lv_color_hex(0xf0d49b),0);
    lv_obj_align(label,LV_ALIGN_TOP_MID,0,y);lv_obj_remove_flag(label,LV_OBJ_FLAG_CLICKABLE);
}
void controller_calibration_ui_init(lv_obj_t *screen) {
    page=lv_obj_create(screen);lv_obj_remove_style_all(page);lv_obj_set_size(page,480,480);
    lv_obj_set_style_bg_color(page,lv_color_hex(0x07131f),0);lv_obj_set_style_bg_opa(page,LV_OPA_COVER,0);
    lv_obj_remove_flag(page,LV_OBJ_FLAG_SCROLLABLE);lv_obj_add_flag(page,LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_transform_pivot_x(page,240,0);lv_obj_set_style_transform_pivot_y(page,240,0);
    lv_obj_set_style_transform_rotation(page,ANKA_CONTROLLER_ROTATION,0);
    text(page,"CALIBRATION",40,&lv_font_montserrat_20);
    text(page,"Choose your playing grip",88,&lv_font_montserrat_20);
    text(page,"Hold A + B, then release",120,&lv_font_montserrat_20);
    for(unsigned i=0;i<2;i++){
        keys[i]=lv_button_create(page);lv_obj_remove_style_all(keys[i]);
        lv_obj_set_pos(keys[i],i?254:30,174);lv_obj_set_size(keys[i],196,152);
        lv_obj_set_style_radius(keys[i],24,0);lv_obj_set_style_border_width(keys[i],3,0);
        lv_obj_set_style_bg_opa(keys[i],LV_OPA_COVER,0);
        lv_obj_add_flag(keys[i],LV_OBJ_FLAG_PRESS_LOCK);lv_obj_remove_flag(keys[i],LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(keys[i],virtual_key,LV_EVENT_ALL,(void*)(uintptr_t)(1U<<i));
        text(keys[i],i?"B":"A",32,&lv_font_montserrat_28);
        text(keys[i],"CALIBRATE",96,&lv_font_montserrat_20);
    }
    progress=lv_bar_create(page);lv_obj_set_pos(progress,40,356);lv_obj_set_size(progress,400,8);
    lv_obj_set_style_bg_color(progress,lv_color_hex(0x73ff83),LV_PART_INDICATOR);
    status=lv_label_create(page);lv_obj_set_style_text_font(status,&lv_font_montserrat_20,0);
    lv_obj_set_style_text_color(status,lv_color_hex(0xc3d6df),0);lv_obj_align(status,LV_ALIGN_TOP_MID,0,398);
    const esp_lv_adapter_touch_callbacks_t callbacks={.custom_touch_read=read_touch};
    ESP_ERROR_CHECK(esp_lv_adapter_set_touch_callbacks(bsp_display_get_input_dev(),&callbacks));
}
void controller_calibration_ui_refresh(uint32_t now,bool connected) {
    controller_calibration_status_t s=controller_calibration_status();
    if(!s.pose.bound||(s.pose.phase==CAL_READY&&now-s.pose.ready_at>=350)){
        lv_obj_add_flag(page,LV_OBJ_FLAG_HIDDEN);return;
    }
    lv_obj_remove_flag(page,LV_OBJ_FLAG_HIDDEN);
    unsigned mask=s.physical|s.screen;
    if(previous_mask!=(int)mask){
        for(unsigned i=0;i<2;i++){
            bool pressed=mask&(1U<<i);
            lv_obj_set_style_border_color(keys[i],lv_color_hex(pressed?0x73ff83:0x66899a),0);
            lv_obj_set_style_bg_color(keys[i],lv_color_hex(pressed?0x193b31:0x122735),0);
        }previous_mask=mask;
    }
    lv_bar_set_value(progress,s.pose.progress,LV_ANIM_OFF);
    if(previous_phase!=(int)s.pose.phase||previous_connection!=(int)connected){
        const char *labels[]={"PRESS BOTH","HOLD A + B","HOLD A + B","HOLD A + B","RELEASE TO SET GRIP","READY","IMU UNAVAILABLE"};
        lv_label_set_text(status,connected?labels[s.pose.phase]:"RECONNECTING");
        lv_obj_align(status,LV_ALIGN_TOP_MID,0,398);
        previous_phase=s.pose.phase;previous_connection=connected;
    }
}
