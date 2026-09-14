import time
import sim_preview as S
actors = S.make_actors(30)
t0=time.time()
for fi in range(2):
    t = fi*0.3
    states=[(a, S.actor_state(a,t,1/12)) for a in actors]
    frame = S.render_frame(states, 1280,720, mode="curved", occlusion=True, text=True)
    frame.save(f"preview/smoke_{fi}.png")
print("ok", time.time()-t0, "s for 2 frames x 30 fish")
