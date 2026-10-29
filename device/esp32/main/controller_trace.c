#include "controller_trace.h"
#include "gesture.h"
#include <string.h>

static lv_obj_t *overlay;
static lv_point_precise_t points[48], origin;
static unsigned count;
static bool held, moving, turning, turn_active;
static float turn_progress, turn_gate_offset;
static int turn_direction;
static uint32_t released;
static lv_opa_t opacity;

static void segment(lv_layer_t *layer,lv_point_precise_t a,lv_point_precise_t b,
                    lv_color_t color,int width,lv_opa_t alpha) {
    lv_draw_line_dsc_t d;lv_draw_line_dsc_init(&d);
    d.p1=a;d.p2=b;d.color=color;d.width=width;d.opa=alpha;d.round_start=d.round_end=1;
    lv_draw_line(layer,&d);
}
static void ring(lv_layer_t *layer,lv_point_precise_t p,int radius,lv_color_t color,bool fill) {
    lv_draw_rect_dsc_t d;lv_draw_rect_dsc_init(&d);
    d.radius=LV_RADIUS_CIRCLE;d.bg_color=color;d.bg_opa=fill?opacity:LV_OPA_TRANSP;
    d.border_color=color;d.border_width=fill?0:2;d.border_opa=opacity;
    lv_area_t area={(int)p.x-radius,(int)p.y-radius,(int)p.x+radius,(int)p.y+radius};
    lv_draw_rect(layer,&d,&area);
}
static void draw(lv_event_t *event) {
    if (!count || !opacity) return;
    lv_layer_t *layer=lv_event_get_layer(event);
    lv_color_t color=lv_color_hex(turning?(turn_active?0xffd17a:0x9ab3c3):(moving?0x38dfff:0xf0d49b));
    lv_point_precise_t p=points[count-1];
    if(turning){
        float end=origin.x+turn_gate_offset;
        int gate_direction=turn_gate_offset<0?-1:1;
        for(float f=0;f<ANKA_GESTURE_TURN_GATE;f+=14){
            lv_point_precise_t a={origin.x+gate_direction*f,origin.y},b={a.x+gate_direction*7,a.y};
            segment(layer,a,b,color,1,opacity/3);
        }
        segment(layer,(lv_point_precise_t){end,origin.y-13},(lv_point_precise_t){end,origin.y+13},color,2,opacity);
        segment(layer,origin,(lv_point_precise_t){origin.x+turn_gate_offset*turn_progress,origin.y},color,3,opacity);
        const float arc[][2]={{-8,4},{-10,-3},{-4,-10},{5,-10},{10,-3},{5,-6},{10,-3},{7,3}};
        for(unsigned i=1;i<8;i++)segment(layer,(lv_point_precise_t){p.x+arc[i-1][0]*turn_direction,p.y+arc[i-1][1]},
            (lv_point_precise_t){p.x+arc[i][0]*turn_direction,p.y+arc[i][1]},color,2,opacity);
    }
    if (moving) {
        segment(layer,origin,p,color,1,opacity/3);
        for(unsigned i=1;i<count;i++)segment(layer,points[i-1],points[i],color,3,opacity*(i+count)/(count*2));
        ring(layer,origin,12,color,false);
    }
    ring(layer,p,moving?19:13,color,false);ring(layer,p,4,color,true);
    if (moving) {
        segment(layer,(lv_point_precise_t){p.x-27,p.y},(lv_point_precise_t){p.x-21,p.y},color,2,opacity);
        segment(layer,(lv_point_precise_t){p.x+21,p.y},(lv_point_precise_t){p.x+27,p.y},color,2,opacity);
        segment(layer,(lv_point_precise_t){p.x,p.y-27},(lv_point_precise_t){p.x,p.y-21},color,2,opacity);
        segment(layer,(lv_point_precise_t){p.x,p.y+21},(lv_point_precise_t){p.x,p.y+27},color,2,opacity);
    }
}
void controller_trace_init(lv_obj_t *parent) {
    overlay=lv_obj_create(parent);lv_obj_remove_style_all(overlay);lv_obj_set_size(overlay,480,480);
    lv_obj_remove_flag(overlay,LV_OBJ_FLAG_CLICKABLE|LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(overlay,draw,LV_EVENT_DRAW_MAIN,NULL);
}
void controller_trace_down(int x,int y,uint32_t now) {
    (void)now;origin=points[0]=(lv_point_precise_t){x,y};count=1;held=true;moving=false;turning=false;opacity=LV_OPA_COVER;
    lv_obj_invalidate(overlay);
}
void controller_trace_move(int x,int y,bool dragging) {
    if(!held)return;
    moving=dragging;lv_point_precise_t p=points[count-1];
    if((p.x-x)*(p.x-x)+(p.y-y)*(p.y-y)<4)return;
    if(count==48){memmove(points,points+1,47*sizeof(*points));count--;}
    points[count++]=(lv_point_precise_t){x,y};lv_obj_invalidate(overlay);
}
void controller_trace_turn(bool enabled,float progress,bool active,int direction,float gate_offset) {
    turning=enabled;turn_progress=progress;turn_active=active;turn_direction=direction;turn_gate_offset=gate_offset;
    if(overlay)lv_obj_invalidate(overlay);
}
void controller_trace_up(uint32_t now,bool cancel) {
    held=false;released=now;if(cancel){count=0;opacity=0;}lv_obj_invalidate(overlay);
}
void controller_trace_tick(uint32_t now) {
    if(held||!count)return;
    uint32_t age=now-released;
    opacity=age>=240?0:LV_OPA_COVER*(240-age)/240;
    if(!opacity)count=0;
    lv_obj_invalidate(overlay);
}
