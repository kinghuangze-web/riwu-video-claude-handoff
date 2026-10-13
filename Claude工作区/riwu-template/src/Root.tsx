import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import type {Plan} from './types';

export const Root: React.FC = () => (
  <Composition
    id="Film"
    component={Film as any}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    defaultProps={{} as any}
    calculateMetadata={({props}: {props: any}) => {
      const p = props as Plan;
      return {durationInFrames: p.frames || 300, fps: p.fps || 30, width: p.width || 1080, height: p.height || 1920};
    }}
  />
);
