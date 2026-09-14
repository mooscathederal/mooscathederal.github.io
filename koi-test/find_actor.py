import sim_preview as S
actors = S.make_actors(30)
a = actors[2]
print("fid", a["fid"])
t = 17/12
x,y,heading,env = S.actor_state(a, t, 1/12)
print("x,y,heading,env", x,y,heading,env)
vw,vh = S.cover_fit(1280/720)
px = (x+vw/2)/vw*1280
py = (1-(y+vh/2)/vh)*720
print("pixel", px, py)
