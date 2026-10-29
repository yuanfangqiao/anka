#include "controller.h"
#include "bsp/esp_mosaico.h"
#include "esp_timer.h"
#include "freertos/task.h"
static void motion(void *unused) {
    (void)unused;
    const bsp_imu_config_t config={.accel_odr=BMI2_ACC_ODR_200HZ,.accel_range=BMI2_ACC_RANGE_4G,
        .gyro_odr=BMI2_GYR_ODR_200HZ,.gyro_range=BMI2_GYR_RANGE_2000};
    bool imu=bsp_imu_init()==ESP_OK&&bsp_imu_start(&config)==ESP_OK,was_ready=false;
    TickType_t wake=xTaskGetTickCount();
    while(true){
        float gyro[3]={0},accel[3]={0};
        bool available=imu&&bsp_imu_get_gyro(&gyro[0],&gyro[1],&gyro[2])==ESP_OK&&
            bsp_imu_get_accel(&accel[0],&accel[1],&accel[2])==ESP_OK;
        uint32_t now=esp_timer_get_time()/1000,id=0;anka_quat_t q;
        bool ready=controller_calibration_sample(gyro,accel,available,controller_snapshot(false).connected,now,&q,&id);
        if(ready){
            controller_pose(q,id);
            if(!was_ready){controller_release();controller_feedback(.35f,100);}
        }
        was_ready=controller_calibration_ready();
        vTaskDelayUntil(&wake,pdMS_TO_TICKS(5));
    }
}
void controller_motion_start(void){configASSERT(xTaskCreate(motion,"handpad_imu",6144,NULL,5,NULL)==pdPASS);}
