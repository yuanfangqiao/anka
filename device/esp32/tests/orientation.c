#include "orientation.h"
#include <assert.h>
#include <math.h>
static void close_pose(anka_quat_t q){assert(fabsf(q.w)>0.9999f);assert(fabsf(q.x)+fabsf(q.y)+fabsf(q.z)<.002f);}
void orientation_tests(void){
 const float zero[]={0,0,0},poses[][3]={{0,1,0},{1,0,0},{0,-1,0},{-1,0,0},{0,0,1},{0,0,-1},{.6f,.3f,.7416198f}};
 for(unsigned p=0;p<7;p++){
  anka_orientation_t o={0};anka_orientation_update(&o,zero,poses[p],1);anka_orientation_reference(&o,poses[p]);
  close_pose(anka_orientation_relative(&o));assert(o.epoch==1);
  float rate[3];for(int k=0;k<3;k++)rate[k]=poses[p][k]*90;
  for(unsigned i=1;i<=800;i++)anka_orientation_update(&o,rate,poses[p],1+i*5);
  close_pose(anka_orientation_relative(&o)); // Full turn returns even when no network frames arrive.
 }
 // The reported physical left turn must use the opposite wire yaw, preserving pitch.
 {
  anka_orientation_t o={0};const float up[]={0,1,0},turn[]={0,60,0};
  anka_orientation_update(&o,zero,up,1);anka_orientation_reference(&o,up);
  for(unsigned i=1;i<=100;i++)anka_orientation_update(&o,turn,up,1+i*5);
  anka_quat_t q=anka_orientation_relative(&o);
  assert(q.y<-.25f&&fabsf(q.x)<.001f);
  o.q=(anka_quat_t){.965925826f,.258819045f,0,0};q=anka_orientation_relative(&o);
  assert(q.x>.25f&&fabsf(q.y)<.001f);
 }
 anka_orientation_t o={0};float up[]={0,1,0},gyro[]={0,0,0};anka_orientation_update(&o,zero,up,1);anka_orientation_reference(&o,up);
 // Compose several body rotations, then exactly undo them in reverse order.
 unsigned now=1;
 for(int pass=0;pass<2;pass++)for(int j=0;j<3;j++){
  int axis=pass?2-j:j;gyro[0]=gyro[1]=gyro[2]=0;gyro[axis]=pass?-60:60;
  for(int n=0;n<100;n++){
   float actual[3];anka_quat_rotate(anka_quat_inverse(o.q),up,actual);
   anka_orientation_update(&o,gyro,actual,now+=5);
  }
 }
 close_pose(anka_orientation_relative(&o));anka_orientation_update(&o,zero,up,now+200);assert(o.gaps==1);
}
