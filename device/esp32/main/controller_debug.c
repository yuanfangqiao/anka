/* Optional standard Iris USB input/screenshot profile for real-device QA. */
#include "controller.h"
#include "controller_decode.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bsp/esp_mosaico.h"
#include "esp_iris.h"
#include "esp_heap_caps.h"
#include "esp_iris_service_profiles.h"
#include "freertos/queue.h"
#include "lvgl.h"
_Static_assert(CONFIG_ESP_IRIS_MAX_RPC_HANDLERS>=12,"Handpad USB profiles require 12 Iris RPC slots");

typedef struct { int16_t x,y; bool pressed; } point_t;
static QueueHandle_t points[2];
static point_t last[2];
static uint8_t *snapshot;
static size_t snapshot_size;
static void read_pointer(lv_indev_t *input,lv_indev_data_t *data) {
    unsigned id=(unsigned)(uintptr_t)lv_indev_get_user_data(input);
    (void)xQueueReceive(points[id],&last[id],0);
    data->point=(lv_point_t){last[id].x,last[id].y};data->state=last[id].pressed?LV_INDEV_STATE_PRESSED:LV_INDEV_STATE_RELEASED;
    data->continue_reading=uxQueueMessagesWaiting(points[id])>0;
}
static esp_err_t pointer_sample(const esp_iris_rpc_request_t *request,uint8_t *out,size_t cap,size_t *size,bool multi) {
    esp_iris_status_t status={0};
    if(esp_iris_get_status(&status)!=ESP_OK||!status.session_ready||status.transport!=ESP_IRIS_TRANSPORT_KIND_USB)return ESP_ERR_NOT_ALLOWED;
    if(request->payload_size!=ESP_IRIS_POINTER_MESSAGE_SIZE||cap<ESP_IRIS_POINTER_MESSAGE_SIZE)return ESP_ERR_INVALID_SIZE;
    const uint8_t *p=request->payload;int16_t x=(int16_t)(p[2]|p[3]<<8),y=(int16_t)(p[4]|p[5]<<8);
    if(p[0]>2||p[1]>(multi?1:0)||x<0||x>=480||y<0||y>=480)return ESP_ERR_INVALID_ARG;
    point_t point={x,y,p[0]!=2};
    if(xQueueSend(points[p[1]],&point,0)!=pdTRUE)return ESP_ERR_TIMEOUT;
    memcpy(out,p,ESP_IRIS_POINTER_MESSAGE_SIZE);*size=ESP_IRIS_POINTER_MESSAGE_SIZE;return ESP_OK;
}
static esp_err_t pointer_rpc(const esp_iris_rpc_request_t *request,uint8_t *out,size_t cap,size_t *size,void *unused) {
    (void)unused;return pointer_sample(request,out,cap,size,false);
}
static esp_err_t screen_begin(const esp_iris_media_desc_t *requested,esp_iris_media_desc_t *actual,uint32_t *size,void *unused) {
    (void)requested;(void)unused;
    if(!bsp_display_lock(1000))return ESP_ERR_TIMEOUT;
    const lv_draw_buf_t *buffer=lv_display_get_buf_active(lv_display_get_default());
    if(!buffer||buffer->header.w!=480||buffer->header.h!=480||buffer->header.cf!=LV_COLOR_FORMAT_RGB565){bsp_display_unlock();return ESP_ERR_NOT_SUPPORTED;}
    snapshot_size=buffer->header.stride*buffer->header.h;
    if(!snapshot)snapshot=heap_caps_malloc(snapshot_size,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!snapshot){bsp_display_unlock();return ESP_ERR_NO_MEM;}
    // The SPI adapter has byte-swapped this full rendered frame for the panel.
    // Normalize our private copy to the standard little-endian Iris RGB565.
    for(size_t i=0;i<snapshot_size;i+=2){snapshot[i]=buffer->data[i+1];snapshot[i+1]=buffer->data[i];}
    *actual=(esp_iris_media_desc_t){.width=480,.height=480,.stride=buffer->header.stride,.format=ESP_IRIS_PIXEL_FORMAT_RGB565};
    *size=snapshot_size;bsp_display_unlock();return ESP_OK;
}
static esp_err_t screen_read(uint32_t offset,uint8_t *out,size_t cap,size_t *size,void *unused) {
    (void)unused;if(!snapshot||offset>snapshot_size)return ESP_ERR_INVALID_ARG;
    *size=snapshot_size-offset;if(*size>cap)*size=cap;
    memcpy(out,snapshot+offset,*size);return ESP_OK;
}
static void screen_end(void *unused){(void)unused;free(snapshot);snapshot=NULL;snapshot_size=0;}

static esp_err_t diagnostics(const esp_iris_rpc_request_t *request,uint8_t *out,size_t cap,size_t *size,void *unused) {
    (void)unused;
    if(request->method_id==7)return pointer_sample(request,out,cap,size,true);
    if(request->method_id==6){
        esp_iris_status_t usb={0};
        if(esp_iris_get_status(&usb)!=ESP_OK||!usb.session_ready||usb.transport!=ESP_IRIS_TRANSPORT_KIND_USB)return ESP_ERR_NOT_ALLOWED;
        if(request->payload_size)return ESP_ERR_INVALID_SIZE;
        controller_exit();*size=0;return ESP_OK;
    }
    if(request->method_id==5){
        esp_iris_status_t usb={0};
        if(esp_iris_get_status(&usb)!=ESP_OK||!usb.session_ready||usb.transport!=ESP_IRIS_TRANSPORT_KIND_USB)return ESP_ERR_NOT_ALLOWED;
        if(request->payload_size!=4)return ESP_ERR_INVALID_SIZE;
        uint32_t offset;memcpy(&offset,request->payload,4);
        *size=controller_decode_capture(offset,out,cap);return *size?ESP_OK:ESP_ERR_NOT_FOUND;
    }
    if(request->method_id==4){
        esp_iris_status_t usb={0};
        if(esp_iris_get_status(&usb)!=ESP_OK||!usb.session_ready||usb.transport!=ESP_IRIS_TRANSPORT_KIND_USB)return ESP_ERR_NOT_ALLOWED;
        if(!request->payload_size||request->payload_size>=1024)return ESP_ERR_INVALID_SIZE;
        char url[1024];memcpy(url,request->payload,request->payload_size);url[request->payload_size]=0;
        (void)controller_scan_accept(url,controller_pair_status().generation);
    }else if(request->payload_size)return ESP_ERR_INVALID_SIZE;
    if(request->method_id==2)controller_scan_start();
    if(request->method_id==3)controller_scan_cancel();
    controller_state_t s=controller_snapshot(false);
    controller_calibration_status_t c=controller_calibration_status();
    const char *phases[]={"WAIT","HOLD","MOVING","TILT","RELEASE","READY","NO_IMU"};
    pair_status_t pair=controller_pair_status();
    int n=snprintf((char*)out,cap,"{\"wifiConnected\":%s,\"wifiSource\":\"%s\",\"scanActive\":%s,\"scanBootAttempted\":%s,\"cameraFrames\":%u,\"cameraError\":%d,\"bound\":%s,\"exiting\":%s,\"stage\":\"%s\",\"generation\":%u,\"decodeCount\":%u,\"decodeUs\":%u,\"previewUs\":%u,\"displayedFrames\":%u,\"opticalReads\":%u,\"handpadVisible\":%s}",
        controller_wifi_ready()?"true":"false",controller_wifi_source(),controller_scan_active()?"true":"false",controller_scan_boot_attempted()?"true":"false",(unsigned)controller_scan_frames(),controller_scan_error(),s.connected?"true":"false",controller_exiting()?"true":"false",controller_pair_label(pair),(unsigned)pair.generation,(unsigned)controller_scan_decodes(),(unsigned)controller_scan_decode_us(),(unsigned)controller_scan_preview_us(),(unsigned)controller_ui_preview_frames(),(unsigned)controller_scan_qr_reads(),controller_ui_handpad_visible()?"true":"false");
    if(n<0||(size_t)n>=cap)return ESP_ERR_NO_MEM;
    int extra=snprintf((char*)out+n-1,cap-n+1,",\"sessionLocked\":%s,\"calibration\":{\"phase\":\"%s\",\"progress\":%u,\"physicalButtons\":%u,\"screenButtons\":%u,\"presses\":[%u,%u],\"moduleOnline\":%s,\"moduleError\":%d,\"buttonMode\":\"gpio\",\"imuAvailable\":%s,\"up\":[%.4f,%.4f,%.4f],\"right\":[%.4f,%.4f,%.4f],\"bias\":[%.4f,%.4f,%.4f]},\"armed\":%s,\"aim\":%s,\"fire\":%s}",
        c.pose.bound?"true":"false",phases[c.pose.phase],c.pose.progress,c.physical,c.screen,c.presses[0],c.presses[1],c.module_online?"true":"false",c.module_error,c.imu_available?"true":"false",c.pose.up[0],c.pose.up[1],c.pose.up[2],c.pose.right[0],c.pose.right[1],c.pose.right[2],c.pose.bias[0],c.pose.bias[1],c.pose.bias[2],s.armed?"true":"false",s.aim?"true":"false",s.fire?"true":"false");
    if(extra<0||(size_t)extra>=cap-n+1)return ESP_ERR_NO_MEM;
    n=n-1+extra;
    char error[48];controller_link_error(error,sizeof(error));
    extra=snprintf((char*)out+n-1,cap-n+1,",\"pose\":{\"id\":%u,\"q\":[%.7f,%.7f,%.7f,%.7f],\"gaps\":%u},\"linkError\":\"%s\",\"turn\":%.6f,\"turnTotal\":%.6f}",
        (unsigned)c.orientation_id,c.orientation.w,c.orientation.x,c.orientation.y,c.orientation.z,(unsigned)c.imu_gaps,error,s.turn,s.turn_total);
    if(extra<0||(size_t)extra>=cap-n+1)return ESP_ERR_NO_MEM;
    *size=n-1+extra;return ESP_OK;
}
void controller_debug_start(void) {
    configASSERT(bsp_display_lock(-1));
    for(unsigned i=0;i<2;i++){
        points[i]=xQueueCreate(16,sizeof(point_t));configASSERT(points[i]);
        lv_indev_t *input=lv_indev_create();lv_indev_set_type(input,LV_INDEV_TYPE_POINTER);
        lv_indev_set_user_data(input,(void*)(uintptr_t)i);lv_indev_set_read_cb(input,read_pointer);
    }
    bsp_display_unlock();
    ESP_ERROR_CHECK(esp_iris_rpc_register(ESP_IRIS_POINTER_SERVICE_ID,ESP_IRIS_POINTER_METHOD_ID,pointer_rpc,NULL));
    const esp_iris_screen_backend_t screen={.begin=screen_begin,.read=screen_read,.end=screen_end};
    ESP_ERROR_CHECK(esp_iris_screen_register(&screen));
    for(int method=1;method<=7;method++)ESP_ERROR_CHECK(esp_iris_rpc_register(0x1300,method,diagnostics,NULL));
}
