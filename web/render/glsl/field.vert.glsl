// Triangle plein écran : chaque pixel reçoit la direction de son rayon dans le monde
uniform mat4 uProjInv, uCamWorld; varying vec3 vDir;
void main(){
  vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
  vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
