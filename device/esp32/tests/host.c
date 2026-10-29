#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gesture.h"
#include "controller_layout.h"
#include "navigation.h"
#include "controller_url.h"
#include "camera_pixels.h"
#include "quirc.h"
#include "qr_pixels.h"
void calibration_tests(void);
static void gestures(void) {
    anka_gesture_t g;
    // Real panel strokes in the clockwise playing orientation: forward/back/left/right.
    const int panel[][2]={{340,240},{140,240},{240,140},{240,340}};
    const float expected[][2]={{0,1},{0,-1},{-1,0},{1,0}};
    for(unsigned i=0;i<4;i++){
        int x,y;anka_controller_point(panel[i][0],panel[i][1],&x,&y);
        anka_gesture_down(&g,240,240,4,0);anka_gesture_move(&g,x,y);
        assert(fabsf(g.move_x-expected[i][0])<.00001f&&fabsf(g.move_y-expected[i][1])<.00001f);
        assert(anka_gesture_up(&g,x,y,4,200)==-1);
    }

    anka_gesture_down(&g, 40, 40, 4, 0);
    assert(anka_gesture_up(&g, 42, 42, 4, 90) == 4);
    anka_gesture_down(&g, 40, 40, 4, 0);
    anka_gesture_move(&g, 100, 0);
    assert(g.dragging && g.move_x > 0 && g.move_y > 0);
    assert(anka_gesture_up(&g, 40, 40, 4, 200) == -1);
    anka_gesture_down(&g, 40, 40, 2, 0);
    assert(anka_gesture_up(&g, 120, 40, 2, 50) == -1);
    anka_gesture_down(&g, 40, 40, 2, 0);
    assert(anka_gesture_up(&g, 40, 40, 2, 900) == -1);
    anka_gesture_down(&g, 40, 40, 4, 0);
    anka_gesture_move(&g, 900, 900);
    assert(fabsf(hypotf(g.move_x, g.move_y)-1) < .00001f);
    anka_gesture_cancel(&g); assert(!g.pressed && !g.move_x && !g.move_y);
    anka_gesture_down(&g,80,90,0,0);anka_gesture_move(&g,156,90);
    assert(!g.turn_active&&!g.turn_angle&&!g.move_x&&!g.move_y);
    anka_gesture_move(&g,156+152.f/3,90);assert(g.turn_active&&fabsf(g.turn_angle-60)<.001f);
    anka_gesture_move(&g,308,90);assert(g.turn_active&&fabsf(g.turn_angle-180)<.001f);
    anka_gesture_move(&g,308,90);assert(!g.turn_delta);
    anka_gesture_move(&g,156,90);assert(fabsf(g.turn_delta+180)<.001f&&!g.turn_angle);
    anka_gesture_move(&g,118,90);assert(fabsf(g.turn_angle+45)<.001f&&g.turn_direction==-1&&g.turn_progress==1);
    anka_gesture_move(&g,4,90);assert(fabsf(g.turn_angle+180)<.001f);
    anka_gesture_move(&g,308,90);assert(fabsf(g.turn_angle-180)<.001f);
    assert(anka_gesture_up(&g,308,90,1,100)==-1);
    anka_gesture_down(&g,400,90,2,0);anka_gesture_move(&g,172,90);assert(fabsf(g.turn_angle+180)<.001f);
    anka_gesture_down(&g,80,90,0,0);anka_gesture_move(&g,400,200);assert(g.turn_blocked&&!g.turn_angle);
    anka_gesture_down(&g,80,240,3,0);anka_gesture_move(&g,400,240);assert(g.dragging&&!g.move_x&&!g.move_y&&!g.turn_delta);
    for(int action=0;action<3;action++){
        anka_gesture_down(&g,0,90,action,0);anka_gesture_move(&g,ANKA_GESTURE_CELL*4.5f,90);
        assert(fabsf(g.turn_angle-720)<.001f);anka_gesture_move(&g,ANKA_GESTURE_CELL*3.5f,90);
        assert(fabsf(g.turn_angle-540)<.001f&&fabsf(g.turn_delta+180)<.001f);
    }

}
static void navigation(void) {
    anka_edge_t edge;
    anka_edge_down(&edge,240,4,0);assert(anka_edge_up(&edge,242,150,200));
    anka_edge_down(&edge,240,475,0);assert(anka_edge_up(&edge,240,300,250));
    anka_edge_down(&edge,240,200,0);assert(!anka_edge_up(&edge,240,400,200));
    anka_edge_down(&edge,240,4,0);assert(!anka_edge_up(&edge,350,150,200));
    anka_edge_down(&edge,240,4,0);assert(!anka_edge_up(&edge,240,150,1500));
}
static void urls(void) {
    char out[1024],origin[256];
    const char *good="https://any-anka.example:8443/v1/device/join?bindKey=abcdefghijklmnop&token=abcdefghijklmnop";
    assert(controller_url_join(good,false,out,sizeof(out)));
    assert(!strncmp(out,"wss://",6));assert(controller_url_origin(out,origin,sizeof(origin)));
    assert(!strcmp(origin,"wss://any-anka.example:8443"));
    assert(!controller_url_join("https://user:pass@anka.example/v1/device/join?bindKey=abcdefghijklmnop&token=abcdefghijklmnop",false,out,sizeof(out)));
    assert(!controller_url_join("https://anka.example/api/admin?bindKey=abcdefghijklmnop&token=abcdefghijklmnop",false,out,sizeof(out)));
    assert(!controller_url_join("https://anka.example/v1/device/join?notbindKey=abcdefghijklmnop&token=abcdefghijklmnop",false,out,sizeof(out)));
    assert(!controller_url_join("https://anka.example/v1/device/join?bindKey=x&token=y",false,out,sizeof(out)));
    const char *local="http://localhost:8000/v1/device/join?bindKey=abcdefghijklmnop&token=abcdefghijklmnop";
    assert(!controller_url_join(local,false,out,sizeof(out)));
    assert(!controller_url_join(local,true,out,sizeof(out)));
    assert(controller_url_join("http://192.168.0.102:5173/v1/device/join?bindKey=abcdefghijklmnop&token=abcdefghijklmnop",true,out,sizeof(out)));
    assert(!controller_url_join(good,false,out,8));
}
static void qr(const char *file, const char *expected) {
    FILE *stream=fopen(file,"rb"); assert(stream);
    char magic[3]; int w,h,max; assert(fscanf(stream,"%2s %d %d %d",magic,&w,&h,&max)==4);
    assert(!strcmp(magic,"P5") && max==255); fgetc(stream);
    struct quirc *q=quirc_new(); assert(q && !quirc_resize(q,w,h));
    uint8_t *original=malloc(w*h);assert(original);assert(fread(original,1,w*h,stream)==(size_t)w*h);fclose(stream);
    uint8_t *pixels=quirc_begin(q,NULL,NULL);memcpy(pixels,original,w*h);
    quirc_end(q); assert(quirc_count(q)>0);
    struct quirc_code *code=malloc(sizeof(*code)); struct quirc_data *data=malloc(sizeof(*data));
    assert(code && data); quirc_extract(q,0,code); assert(!quirc_decode(code,data));
    assert((size_t)data->payload_len==strlen(expected) && !memcmp(data->payload,expected,data->payload_len));
    // Exercise the actual padded DMA-frame crop/luma path, not just a clean PGM.
    const uint32_t width=1024,height=768,stride=2080;
    size_t bytes=(size_t)stride*height;
    uint8_t *raw=malloc(bytes);assert(raw);
    for(size_t i=0;i<bytes;i+=2){raw[i]=(i&2)?196:64;raw[i+1]=235;}
    anka_camera_crop_t crop;
    assert(anka_camera_crop(width,height,stride,bytes,&crop));
    assert(crop.x==192 && crop.y==64 && crop.size==640 && crop.stride==stride);
    assert(!anka_camera_crop(width,height,stride,bytes-1,&crop));
    assert(!anka_camera_crop(width,height,width*2-2,bytes,&crop));
    assert(!anka_camera_crop(640,480,0,bytes,&crop));
    assert(anka_camera_crop(width,height,stride,bytes,&crop));
    assert(w<640 && h<640);
    for(int y=0;y<h;y++)for(int x=0;x<w;x++){
        size_t i=(size_t)(crop.y+(640-h)/2+y)*stride+(crop.x+(640-w)/2+x)*2+1;
        raw[i]=original[y*w+x]?235:16;
    }
    assert(!quirc_resize(q,640,640));pixels=quirc_begin(q,NULL,NULL);
    anka_camera_luma(raw,&crop,pixels);free(raw);
    uint8_t *gray=malloc(640*640);assert(gray);memcpy(gray,pixels,640*640);quirc_end(q);
    assert(quirc_count(q)>0);quirc_extract(q,0,code);assert(!quirc_decode(code,data));
    assert((size_t)data->payload_len==strlen(expected) && !memcmp(data->payload,expected,data->payload_len));
    const unsigned sizes[]={320,480,640};
    for(unsigned i=0;i<3;i++)for(unsigned reverse=0;reverse<2;reverse++){
        unsigned size=sizes[i];assert(!quirc_resize(q,size,size));
        anka_qr_pixels(gray,quirc_begin(q,NULL,NULL),size,reverse);quirc_end(q);
        assert(quirc_count(q)>0);quirc_extract(q,0,code);assert(!quirc_decode(code,data));
        assert((size_t)data->payload_len==strlen(expected)&&!memcmp(data->payload,expected,data->payload_len));
    }
    free(gray);
    free(original);free(code);free(data);quirc_destroy(q);
}
void orientation_tests(void);
int main(int argc,char **argv) {
    assert(argc==3);gestures();navigation();urls();qr(argv[1],argv[2]);calibration_tests();orientation_tests();
    puts("Firmware host checks passed: touch/QR, calibration chord/release gating, six grip poses, bias, natural tremor/flat acceptance, quaternion round trips, reconnect preservation.");
}
