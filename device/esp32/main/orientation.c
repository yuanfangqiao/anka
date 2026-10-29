#include "orientation.h"
#include <math.h>
static anka_quat_t unit(anka_quat_t q) {
    float n=sqrtf(q.w*q.w+q.x*q.x+q.y*q.y+q.z*q.z);
    return n>1e-8f?(anka_quat_t){q.w/n,q.x/n,q.y/n,q.z/n}:(anka_quat_t){1,0,0,0};
}
anka_quat_t anka_quat_inverse(anka_quat_t q){return (anka_quat_t){q.w,-q.x,-q.y,-q.z};}
anka_quat_t anka_quat_multiply(anka_quat_t a,anka_quat_t b) {
    return (anka_quat_t){a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
        a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
        a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w};
}
void anka_quat_rotate(anka_quat_t q,const float in[3],float out[3]) {
    anka_quat_t v=anka_quat_multiply(anka_quat_multiply(q,(anka_quat_t){0,in[0],in[1],in[2]}),anka_quat_inverse(q));
    out[0]=v.x;out[1]=v.y;out[2]=v.z;
}
anka_quat_t anka_orientation_basis(const float a[3]) {
    float n=sqrtf(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);
    float u[3]={0,1,0};if(n>.1f)for(int i=0;i<3;i++)u[i]=a[i]/n;
    float planar=hypotf(u[0],u[1]),r[3];
    if(planar>.15f){r[0]=u[1]/planar;r[1]=-u[0]/planar;r[2]=0;}
    else{ // Flat is valid: project screen-right onto the gravity-orthogonal plane.
        r[0]=1-u[0]*u[0];r[1]=-u[0]*u[1];r[2]=-u[0]*u[2];
        float length=sqrtf(r[0]*r[0]+r[1]*r[1]+r[2]*r[2]);for(int i=0;i<3;i++)r[i]/=length;
    }
    float f[3]={r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]};
    float m[3][3]={{r[0],u[0],f[0]},{r[1],u[1],f[1]},{r[2],u[2],f[2]}};
    float q[4],trace=m[0][0]+m[1][1]+m[2][2];
    if(trace>0){float s=sqrtf(trace+1)*2;q[0]=s/4;q[1]=(m[2][1]-m[1][2])/s;q[2]=(m[0][2]-m[2][0])/s;q[3]=(m[1][0]-m[0][1])/s;}
    else{
        int i=m[1][1]>m[0][0]?1:0;if(m[2][2]>m[i][i])i=2;int j=(i+1)%3,k=(i+2)%3;
        float s=sqrtf(1+m[i][i]-m[j][j]-m[k][k])*2;
        q[0]=(m[k][j]-m[j][k])/s;q[i+1]=s/4;q[j+1]=(m[i][j]+m[j][i])/s;q[k+1]=(m[i][k]+m[k][i])/s;
    }
    return unit((anka_quat_t){q[0],q[1],q[2],q[3]});
}
void anka_orientation_update(anka_orientation_t *o,const float gyro[3],const float accel[3],uint32_t now) {
    for(int i=0;i<3;i++)if(!isfinite(gyro[i])||!isfinite(accel[i]))return;
    float n=sqrtf(accel[0]*accel[0]+accel[1]*accel[1]+accel[2]*accel[2]);
    if(!o->started){
        if(n<.1f)return;
        o->q=(anka_quat_t){1,0,0,0};o->started=true;o->last=now;
        for(int i=0;i<3;i++)o->gravity[i]=accel[i]/n;
        return;
    }
    float dt=(now-o->last)/1000.f;o->last=now;if(dt<=0)return;
    if(dt>.1f){o->gaps++;return;}
    float w[3];for(int i=0;i<3;i++)w[i]=gyro[i]*(3.14159265358979323846f/180.f);
    if(n>.8f&&n<1.2f){
        float predicted[3],measured[3];anka_quat_rotate(anka_quat_inverse(o->q),o->gravity,predicted);
        for(int i=0;i<3;i++)measured[i]=accel[i]/n;
        float error[3]={measured[1]*predicted[2]-measured[2]*predicted[1],measured[2]*predicted[0]-measured[0]*predicted[2],measured[0]*predicted[1]-measured[1]*predicted[0]};
        for(int i=0;i<3;i++)w[i]+=1.5f*error[i];
    }
    float speed=sqrtf(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]);
    if(speed<1e-8f)return;
    float half=speed*dt*.5f,s=sinf(half)/speed;
    o->q=unit(anka_quat_multiply(o->q,(anka_quat_t){cosf(half),w[0]*s,w[1]*s,w[2]*s}));
}
void anka_orientation_reference(anka_orientation_t *o,const float accel[3]) {
    o->reference=o->q;o->basis=anka_orientation_basis(accel);o->calibrated=o->started;
    if(o->calibrated)++o->epoch;
}
anka_quat_t anka_orientation_relative(const anka_orientation_t *o) {
    if(!o->calibrated)return (anka_quat_t){1,0,0,0};
    anka_quat_t relative=anka_quat_multiply(anka_quat_inverse(o->reference),o->q);
    anka_quat_t q=unit(anka_quat_multiply(anka_quat_multiply(anka_quat_inverse(o->basis),relative),o->basis));
    // Mosaico's physical horizontal heading is opposite the controller wire convention.
    // Reflect heading and roll together to preserve a valid rotation; pitch is unchanged.
    return (anka_quat_t){q.w,q.x,-q.y,-q.z};
}
