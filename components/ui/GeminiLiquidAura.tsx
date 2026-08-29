import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const GLSL_SHADER = `
uniform vec2 resolution;
uniform float time;
uniform float isProcessing;

// Hash function for noise
vec2 hash( vec2 p ) {
    p = vec2( dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)) );
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

// Simplex/Perlin noise approximation
float noise( in vec2 p ) {
    const float K1 = 0.366025404;
    const float K2 = 0.211324865;
    vec2  i = floor( p + (p.x+p.y)*K1 );
    vec2  a = p - i + (i.x+i.y)*K2;
    float m = step( a.y, a.x ); 
    vec2  o = vec2( m, 1.0-m );
    vec2  b = a - o + K2;
    vec2  c = a - 1.0 + 2.0*K2;
    vec3  h = max( 0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
    vec3  n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
    return dot( n, vec3(70.0) );
}

vec4 main(vec2 fragCoord) {
    vec2 uv = fragCoord / resolution;
    
    float speed = isProcessing > 0.0 ? 1.5 : 0.5;
    float t = time * speed;
    
    float n1 = noise(uv * 2.5 + vec2(t * 0.4, t * 0.2));
    float n2 = noise(uv * 3.0 - vec2(t * 0.3, t * 0.5));
    float n3 = noise(uv * 2.0 + vec2(t * -0.5, t * 0.3));
    
    float totalNoise = (n1 + n2 + n3) / 3.0;
    
    vec3 cyan = vec3(0.0, 0.83, 0.78); 
    vec3 violet = vec3(0.55, 0.36, 0.96); 
    vec3 magenta = vec3(0.93, 0.28, 0.6); 
    
    vec3 finalColor = mix(cyan, violet, smoothstep(-0.4, 0.4, totalNoise + sin(t*0.5)*0.2));
    finalColor = mix(finalColor, magenta, smoothstep(0.0, 0.8, n1 - n2));
    
    float alpha = mix(0.15, 0.35, smoothstep(-1.0, 1.0, n3));
    return vec4(finalColor * alpha, alpha);
}
`;

interface GeminiLiquidAuraProps {
  isProcessing?: boolean;
}

export default function GeminiLiquidAura({ isProcessing = false }: GeminiLiquidAuraProps) {
  const [time, setTime] = useState(0);

  useEffect(() => {
    let frame = 0;
    const timer = setInterval(() => {
      frame = (frame + 1) % 10000;
      setTime(frame / 20);
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // Web does not support synchronous Skia instantiation without LoadSkiaWeb
  if (Platform.OS === 'web') {
    return <View style={[styles.container, { backgroundColor: 'rgba(0, 212, 199, 0.1)' }]} />;
  }

  // Safely require Skia ONLY on native to prevent web crashes
  const { Canvas, Fill, RuntimeShader, Skia } = require('@shopify/react-native-skia');
  
  const source = useMemo(() => {
    try {
      return Skia.RuntimeEffect.Make(GLSL_SHADER);
    } catch (e) {
      return null;
    }
  }, []);

  if (!source) return <View style={styles.container} />;

  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas style={{ flex: 1 }}>
        <Fill>
          <RuntimeShader 
            source={source} 
            uniforms={{
              resolution: [SCREEN_WIDTH, 200],
              time: time,
              isProcessing: isProcessing ? 1.0 : 0.0
            }} 
          />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 0,
  }
});
