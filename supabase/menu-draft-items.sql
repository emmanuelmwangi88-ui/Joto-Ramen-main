-- Menu items found on the Uber Eats / Glovo listings (Oct 2026). Added HIDDEN (is_available=false).
-- Prices are ESTIMATES (dine-in guessed at ~74% of the delivery-app price, rounded). Confirm each price with the
-- owner, then show the item in Admin > Menu Manager. Safe to re-run (skips names that already exist).
alter table public.menu_items drop constraint if exists menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check
  check (category in ('ramen','starters','sides','drinks','desserts','toppings'));

insert into public.menu_items (name,name_jp,description,price,category,tags,spicy,image_url,is_available)
select v.*, false from (values
 ('Shoyu Ramen','醤油ラーメン','Simple shoyu ramen: chicken soup with blended soy sauce, chicken oil, handmade wheat noodles, pork belly char-siu, baby spinach and spring onion.',1350,'ramen',array['pork'],0,null),
 ('Kids Shoyu Ramen','キッズ醤油ラーメン','Kid-friendly ramen with rich chicken soup, handmade noodles, char-siu, flavoured egg, bamboo shoots, spinach, spring onion and seaweed.',1050,'ramen',array['pork'],0,null),
 ('Chicken Dumplings','鶏餃子','Local chicken with house-blended seasoning wrapped in home-made skin.',800,'starters',array[]::text[],0,null),
 ('Pork Dumplings','豚餃子','Juicy pork and leek wrapped in home-made skin. Pork is served at the Lavington branch only.',800,'starters',array['pork'],0,null),
 ('Deep Fried Chicken Dumplings (5 pcs)','揚げ鶏餃子','Chicken and house seasoning in home-made skin, deep fried: crispy outside, juicy inside.',800,'starters',array[]::text[],0,null),
 ('Deep Fried Pork Dumplings (5 pcs)','揚げ豚餃子','Pork and leek in home-made skin, deep fried. Pork is served at the Lavington branch only.',800,'starters',array['pork'],0,null),
 ('Takoyaki Octopus Balls (6 pcs)','たこ焼き','Japanese octopus balls.',600,'starters',array[]::text[],0,null),
 ('Takoyaki Octopus Balls (12 pcs)','たこ焼き','Japanese octopus balls, sharing size.',950,'starters',array[]::text[],0,null),
 ('Spicy Crunchy Cucumber','ピリ辛きゅうり','Crunchy cucumber with a spicy dressing.',350,'starters',array['spicy'],1,null),
 ('Kimchi','キムチ','Home-made spicy kimchi.',350,'starters',array['spicy'],2,null),
 ('Stir Fried Pak Choy','青梗菜炒め','Flavourful stir-fried pak choy.',600,'starters',array['vegan'],0,null),
 ('Kimchi Fried Rice','キムチチャーハン','Fried rice with house kimchi.',1350,'sides',array['spicy'],1,null),
 ('Egg Fried Rice','卵チャーハン','Classic egg fried rice.',1050,'sides',array[]::text[],0,null),
 ('Karaage Bowl','唐揚げ丼','Our famous karaage on rice with special sauce.',1350,'sides',array['popular'],0,null),
 ('Coca-Cola 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Coca-Cola Zero 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Fanta Orange 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Fanta Blackcurrant 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Sprite 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Mayers Sparkling Water 500ml','','',200,'drinks',array[]::text[],0,null),
 ('Extra: Pork Belly Char-Siu','チャーシュー','Marinated pork belly, roasted char-siu style. Lavington branch only.',220,'toppings',array['pork'],0,null),
 ('Extra: Chicken Breast Char-Siu','鶏チャーシュー','Lean chicken breast slow-cooked in char-siu marinade.',220,'toppings',array[]::text[],0,null),
 ('Extra: Flavoured Egg','味玉','Soft-boiled egg marinated in a savoury soy sauce.',220,'toppings',array[]::text[],0,null),
 ('Extra: Noodles (half portion)','替え玉','Half portion of extra noodles.',150,'toppings',array[]::text[],0,null),
 ('Extra: Spring Onion','ネギ','Freshly sliced spring onion.',110,'toppings',array['vegan'],0,null),
 ('Extra: Baby Spinach','ほうれん草','Steamed baby spinach, lightly seasoned.',110,'toppings',array['vegan'],0,null),
 ('Extra: Corn','コーン','Sweet corn kernels.',110,'toppings',array['vegan'],0,null)
) as v(name,name_jp,description,price,category,tags,spicy,image_url)
where not exists (select 1 from public.menu_items m where m.name = v.name);

update public.menu_items set description='Rich chicken-based broth with soy sauce and chicken oil, handmade wheat noodles, slow-cooked chicken breast, flavoured egg, bamboo shoots, baby spinach, spring onion and seaweed.' where name='Special Shoyu';
update public.menu_items set description='Miso-and-chicken broth with chicken oil, handmade noodles, flavoured chicken mince, egg, bamboo shoots, baby spinach, corn and spring onion. Pork belly char-siu and pork mince at the Lavington branch only.' where name='Special Miso';
update public.menu_items set description='Creamy chicken (paitan) broth with soy sauce and chicken oil, handmade noodles, sliced chicken, flavoured egg, red onion, spring onion, nori and a touch of lime. A local favourite.' where name='Special Creamy Chicken (Paitan) Ramen';
update public.menu_items set description='Energy-boosting ramen in rich chicken broth with blended soy sauce, chicken oil, handmade noodles, wood ear fungus, spring onion, garlic chips, garlic oil and seaweed. Pork belly char-siu at the Lavington branch only.' where name='Black Garlic Bomb Ramen';
update public.menu_items set description='Nairobi-inspired ramen topped with pressure-cooked ossobuco, finished with corn, spring onion and whole chillies.' where name='Kanairo Ramen';
update public.menu_items set description='Most popular side: Japanese-style fried chicken, crispy outside and juicy inside.' where name='Karaage';
