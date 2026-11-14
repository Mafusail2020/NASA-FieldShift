# Enterprise yields (Derzhstat) - NOT YET PROVIDED

Expected file `yields.csv`, one row per oblast, crop and year:

```
oblast,crop,year,yield_t_ha,source,status
poltavska,winter_wheat,2000,2.9,"Derzhstat, Roslynnytstvo Ukrainy 2021, table X, agricultural enterprises",data
```

- `oblast`: vinnytska, poltavska, kirovohradska, odeska.
- `crop`: winter_wheat, maize, sunflower, pea. Yield of **enterprises**, not all categories of farms.
- Units t/ha (Derzhstat gives c/ha: divide by 10).
- Years 2000-2021 at least (the trend window); later years only if the war masks are applied.
- `www.ukrstat.gov.ua` had an expired SSL certificate on 2026-11-14, so it could not be fetched automatically.
