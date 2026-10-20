-- Gives every dish and the gallery an image saved in the project (public/images/...) instead of a link to another website.
-- Only touches dishes that have no photo yet or still use a web link, so photos uploaded in Admin are kept. Safe to re-run.
update public.menu_items set image_url = 'images/menu/' || case
  when category = 'ramen' then case
    when name ilike '%garlic%' then 'ramen-garlic'
    when name ilike '%vegan%' then 'ramen-vegan'
    when name ilike '%spicy%' then 'ramen-spicy'
    when name ilike '%miso%' then 'ramen-miso'
    when name ilike '%paitan%' or name ilike '%creamy%' or name ilike '%kanairo%' then 'ramen-creamy'
    else 'ramen-shoyu' end
  when category = 'starters' then case
    when name ilike '%fried%dumpling%' then 'starter-fried-dumplings'
    when name ilike '%dumpling%' or name ilike '%gyoza%' then 'starter-dumplings'
    when name ilike '%karaage%' then 'starter-karaage'
    when name ilike '%takoyaki%' then 'starter-takoyaki'
    when name ilike '%kimchi%' then 'starter-kimchi'
    when name ilike '%edamame%' then 'starter-edamame'
    else 'starter-greens' end
  when category = 'sides' then case
    when name ilike '%potato%' then 'side-potato'
    when name ilike '%karaage%' then 'side-karaage-bowl'
    else 'side-rice' end
  when category = 'drinks' then case
    when name ilike '%tea%' then 'drink-tea'
    when name ilike '%orange%' then 'drink-orange'
    when name ilike '%coca%' or name ilike '%blackcurrant%' then 'drink-soda'
    else 'drink-clear' end
  when category = 'desserts' then 'dessert-icecream'
  else case
    when name ilike '%egg%' then 'topping-egg'
    when name ilike '%char-siu%' then 'topping-meat'
    when name ilike '%noodle%' then 'topping-noodles'
    when name ilike '%corn%' then 'topping-corn'
    else 'topping-green' end
  end || '.svg'
where image_url is null or image_url like 'http%';

insert into public.gallery (src, alt, location_id)
select v.src, v.alt, null from (values
  ('images/gallery/restaurant.jpg', 'Inside Joto Ramen under the red lanterns'),
  ('images/gallery/lanterns.jpg', 'Hanging red lanterns'),
  ('images/gallery/counter.jpg', 'The open kitchen counter'),
  ('images/gallery/tables-left.jpg', 'Tables and seating'),
  ('images/gallery/dining.jpg', 'The dining area')) as v(src, alt)
where not exists (select 1 from public.gallery g where g.src = v.src);
