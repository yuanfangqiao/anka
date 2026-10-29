#include "controller.h"
#include "controller_decode.h"
#include "camera_pixels.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/task.h"
#include "quirc.h"
#include "qr_pixels.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
typedef struct {uint8_t *gray;uint32_t generation;} image_t;
static QueueHandle_t available,latest;
static atomic_uint decodes,decode_us,qr_reads;
uint32_t controller_scan_decodes(void){return atomic_load(&decodes);}
uint32_t controller_scan_decode_us(void){return atomic_load(&decode_us);}
uint32_t controller_scan_qr_reads(void){return atomic_load(&qr_reads);}
static bool decode(struct quirc *q,struct quirc_code *code,struct quirc_data *data,const image_t *image,int size,bool reverse,bool *candidate) {
    uint8_t *pixels=quirc_begin(q,NULL,NULL);
    anka_qr_pixels(image->gray,pixels,size,reverse);
    quirc_end(q);
    if(candidate)*candidate=quirc_count(q)>0;
    for(int i=0;i<quirc_count(q);i++){
        if(image->generation!=controller_pair_status().generation)return false;
        quirc_extract(q,i,code);quirc_decode_error_t error=quirc_decode(code,data);
        if(error){quirc_flip(code);error=quirc_decode(code,data);}
        if(!error&&data->payload_len>0&&data->payload_len<1024){
            atomic_fetch_add(&qr_reads,1);
            char url[1024];memcpy(url,data->payload,data->payload_len);url[data->payload_len]=0;
            if(controller_scan_accept(url,image->generation))return true;
        }
    }
    return false;
}
static void worker(void *unused) {
    (void)unused;
    struct quirc *small=quirc_new(),*medium=quirc_new(),*large=quirc_new();
    struct quirc_code *code=malloc(sizeof(*code));struct quirc_data *data=malloc(sizeof(*data));
    configASSERT(small&&medium&&large&&code&&data);
    configASSERT(!quirc_resize(small,320,320)&&!quirc_resize(medium,480,480)&&!quirc_resize(large,ANKA_SCAN_SIZE,ANKA_SCAN_SIZE));
    unsigned attempt=0;
    while(true){
        image_t image;if(xQueueReceive(latest,&image,portMAX_DELAY)!=pdTRUE)continue;
        pair_status_t status=controller_pair_status();
        if(image.generation==status.generation&&(status.stage==PAIR_SCAN||status.stage==PAIR_ERROR)){
            int64_t start=esp_timer_get_time();
            bool candidate=false;
            bool found=decode(small,code,data,&image,320,false,&candidate);
            if(!found&&(candidate||++attempt%3==0)){
                found=decode(medium,code,data,&image,480,false,NULL);
                if(!found)decode(large,code,data,&image,ANKA_SCAN_SIZE,true,NULL);
            }
            atomic_store(&decode_us,esp_timer_get_time()-start);atomic_fetch_add(&decodes,1);
        }
        xQueueSend(available,&image.gray,portMAX_DELAY);vTaskDelay(pdMS_TO_TICKS(1));
    }
}
bool controller_decode_start(void) {
    available=xQueueCreate(2,sizeof(uint8_t*));latest=xQueueCreate(1,sizeof(image_t));
    if(!available||!latest)return false;
    for(int i=0;i<2;i++){
        uint8_t *gray=heap_caps_malloc(ANKA_SCAN_SIZE*ANKA_SCAN_SIZE,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
        if(!gray)return false;
        xQueueSend(available,&gray,0);
    }
    return xTaskCreatePinnedToCore(worker,"qr_decode",12288,NULL,1,NULL,0)==pdPASS;
}
uint8_t *controller_decode_buffer(void) {
    uint8_t *gray=NULL;
    if(xQueueReceive(available,&gray,0)!=pdTRUE){
        image_t obsolete;if(xQueueReceive(latest,&obsolete,0)==pdTRUE)gray=obsolete.gray;
    }
    return gray;
}
void controller_decode_submit(uint8_t *gray,uint32_t generation) {
    if(!gray)return;
    image_t obsolete,image={gray,generation};
    if(xQueueReceive(latest,&obsolete,0)==pdTRUE)xQueueSend(available,&obsolete.gray,portMAX_DELAY);
    if(xQueueSend(latest,&image,0)!=pdTRUE)xQueueSend(available,&gray,portMAX_DELAY);
}
unsigned controller_decode_capture(uint32_t offset,uint8_t *out,unsigned cap) {
    static uint8_t *snapshot;
    const uint32_t bytes=ANKA_SCAN_SIZE*ANKA_SCAN_SIZE;
    if(offset==0){
        if(snapshot){xQueueSend(available,&snapshot,portMAX_DELAY);snapshot=NULL;}
        image_t image;
        if(xQueueReceive(latest,&image,0)!=pdTRUE)return 0;
        snapshot=image.gray;
    }
    if(!snapshot||offset>=bytes)return 0;
    unsigned count=bytes-offset;if(count>cap)count=cap;
    memcpy(out,snapshot+offset,count);
    if(offset+count==bytes){xQueueSend(available,&snapshot,portMAX_DELAY);snapshot=NULL;}
    return count;
}
