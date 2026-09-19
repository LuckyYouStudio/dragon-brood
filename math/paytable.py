# Exact paytable proof for Dragon Brood. Weights out of 1,000,000; multipliers x100.
from fractions import Fraction
from math import isqrt
D = 1_000_000
TIERS = {
 1: [(10000,500),(40000,300),(120000,200),(200000,150),(250000,100)],
 2: [(4000,2500),(12000,1000),(40000,500),(140000,200),(260000,100)],
 3: [(1000,10000),(6000,2500),(20000,1000),(60000,400),(180000,150)],
 4: [(200,50000),(1500,10000),(8000,2500),(30000,800),(135000,200)],
 5: [(40,250000),(300,50000),(2000,10000),(12000,2000),(90000,300)],
}
for t,rows in TIERS.items():
    rtp = sum(Fraction(w,D)*Fraction(m,100) for w,m in rows)
    hit = sum(w for w,_ in rows)
    body = rows[1:]
    ex = sum(Fraction(w,D)*Fraction(m,100) for w,m in body)
    ex2 = sum(Fraction(w,D)*Fraction(m,100)**2 for w,m in body)
    var = ex2-ex*ex
    sigma_wad = isqrt(int(var*10**36))+1  # round up
    print(t,'RTP',rtp,float(rtp),'hit',hit/D,'top p',rows[0][0]/D,'bodyVar',float(var),'bodySigmaWad',sigma_wad)
