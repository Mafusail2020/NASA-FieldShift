source: Field Shift PROGRESS.md and data README (known limits)
status: data

# What the data is
Weather is NASA POWER daily data (MERRA-2 reanalysis, community AG), 1991-2025, for the centre of a 0.5 x 0.625 degree grid cell, about 55 km by 50 km. Reference evapotranspiration is FAO-56 Penman-Monteith. Rain in reanalysis is smoothed and misses single local storms. Soil texture comes from SoilGrids 2.0 at 250 m, read at the cell centre, so a given field may differ. The result is an analysis for the area, not for one field.

# What is not real yet
Finance charts, costs and prices are SAMPLE data until real prices, costs and yields exist. Rotations A-E are drafts to be approved by an agronomist. No yield forecasts exist. Season twins cover winter wheat and maize only.

# Known data gaps
Salt tolerance is missing for millet, buckwheat, white mustard and narrow-leaf lupin. Humus parameters are missing for winter rapeseed and buckwheat and for mineralisation under black fallow. Heat windows for maize, sunflower, pea and soybean are not set, so heat days are not computed for them. Sowing rule for sunflower and pea is not set. When the app says "no data", it means one of these gaps.

# Status labels
data = measured or entered by the farmer; literature = taken from a published table; estimate = our model or assumption; sample = illustrative number, not real.
