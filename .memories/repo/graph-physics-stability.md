# Graph Physics Stability Configuration

## Problem Solved
Fixed flying nodes issue where nodes rapidly moved off-screen with small graphs.

## Root Causes
1. friction=0.95 retained 95% momentum, linkSpring=0.1 too weak
2. Nodes defaulting to [0,0] caused infinite repulsion
3. gravity=0.05 could not counteract repulsion=0.5 in small graphs
4. Auto-fit zoomed extremely close on tiny graphs

## Solution Parameters
repulsion=0.5, linkSpring=0.85, linkDistance=2, friction=0.4, gravity=dynamic

## Dynamic Gravity
Graphs with <10 nodes get 6x gravity (1.5 vs 0.25) to prevent dispersion.

## Coordinate Initialization
All nodes spawn with randomized x/y to prevent zero-distance repulsion.

## Key Insight
Friction is velocity retention. 0.4 = heavy damping for fast settling.
Link spring 0.85 holds graph together like tight mesh.
