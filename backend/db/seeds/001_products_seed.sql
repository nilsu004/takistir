BEGIN;

TRUNCATE products, categories RESTART IDENTITY CASCADE;

INSERT INTO categories (name) VALUES
  ('Rings'),
  ('Necklaces'),
  ('Earrings'),
  ('Watches');

INSERT INTO products (category_id, name, model, serial_number, description,
                      stock_quantity, price, cost, warranty_status, distributor)
SELECT c.id, v.name, v.model, v.serial_number, v.description,
       v.stock_quantity, v.price, v.cost, v.warranty_status, v.distributor
FROM (VALUES
  -- Rings
  ('Rings', 'Minimal Silver Band', 'RNG-SLV-01', 'TKS-RNG-0001', 'Thin 925 sterling silver band with a polished finish; stackable everyday ring.', 25, 890.00, NULL::NUMERIC, '6 months', 'Boğaziçi Gümüş Ltd.'),
  ('Rings', 'Gold-Plated Signet Ring', 'RNG-GLD-02', 'TKS-RNG-0002', 'Gold-plated brass signet ring with a flat oval face; unisex design.', 12, 1450.00, 620.00, '1 year', 'Ege Takı Dağıtım A.Ş.'),
  ('Rings', 'Emerald Stone Ring', 'RNG-STN-03', 'TKS-RNG-0003', 'Sterling silver ring with a green zirconia stone in a vintage setting.', 0, 1890.00, NULL, '1 year', 'Boğaziçi Gümüş Ltd.'),
  ('Rings', 'Twisted Rope Ring', 'RNG-SLV-04', 'TKS-RNG-0004', 'Twisted rope pattern in 925 silver; adjustable open-ended size.', 40, 650.00, NULL, '6 months', 'Boğaziçi Gümüş Ltd.'),
  ('Rings', 'Black Steel Ring', 'RNG-STL-05', 'TKS-RNG-0005', 'Matte black stainless steel ring, scratch resistant and water safe.', 2, 720.00, 300.00, 'No warranty', 'Marmara Aksesuar Tic.'),
  -- Necklaces
  ('Necklaces', 'Pearl Drop Necklace', 'NCK-PRL-01', 'TKS-NCK-0001', 'Freshwater pearl pendant on a fine 925 silver chain, 45 cm.', 15, 2350.00, NULL, '1 year', 'Ege Takı Dağıtım A.Ş.'),
  ('Necklaces', 'Initial Letter Necklace', 'NCK-GLD-02', 'TKS-NCK-0002', 'Gold-plated chain with a personalised initial letter pendant.', 30, 1290.00, NULL, '6 months', 'Ege Takı Dağıtım A.Ş.'),
  ('Necklaces', 'Evil Eye Pendant', 'NCK-SLV-03', 'TKS-NCK-0003', 'Blue enamel evil eye charm on a minimalist silver chain.', 50, 780.00, 350.00, '6 months', 'Boğaziçi Gümüş Ltd.'),
  ('Necklaces', 'Layered Chain Necklace', 'NCK-GLD-04', 'TKS-NCK-0004', 'Three gold-plated chains of different lengths worn as one layered piece.', 0, 1690.00, NULL, '1 year', 'Marmara Aksesuar Tic.'),
  ('Necklaces', 'Moon and Star Choker', 'NCK-SLV-05', 'TKS-NCK-0005', 'Short silver choker with small moon and star charms.', 8, 990.00, NULL, '6 months', 'Boğaziçi Gümüş Ltd.'),
  -- Earrings
  ('Earrings', 'Small Hoop Earrings', 'EAR-SLV-01', 'TKS-EAR-0001', 'Classic 15 mm sterling silver hoops for everyday wear.', 45, 590.00, NULL, '6 months', 'Boğaziçi Gümüş Ltd.'),
  ('Earrings', 'Pearl Stud Earrings', 'EAR-PRL-02', 'TKS-EAR-0002', 'Freshwater pearl studs with 925 silver posts; hypoallergenic.', 20, 850.00, 380.00, '1 year', 'Ege Takı Dağıtım A.Ş.'),
  ('Earrings', 'Statement Tassel Earrings', 'EAR-TSL-03', 'TKS-EAR-0003', 'Long burgundy tassel drop earrings with gold-plated hooks.', 0, 690.00, NULL, 'No warranty', 'Marmara Aksesuar Tic.'),
  ('Earrings', 'Geometric Drop Earrings', 'EAR-GLD-04', 'TKS-EAR-0004', 'Gold-plated triangle drop earrings with a modern geometric design.', 10, 1150.00, NULL, '6 months', 'Marmara Aksesuar Tic.'),
  ('Earrings', 'Crystal Ear Cuff', 'EAR-CRS-05', 'TKS-EAR-0005', 'No-piercing silver ear cuff lined with small crystals.', 3, 760.00, NULL, '6 months', 'Boğaziçi Gümüş Ltd.'),
  -- Watches
  ('Watches', 'Classic Leather Watch', 'WTC-LTH-01', 'TKS-WTC-0001', 'Analog quartz watch with a brown genuine leather strap and 40 mm case.', 14, 4250.00, 2100.00, '2 years', 'Anadolu Saat Dağıtım Ltd.'),
  ('Watches', 'Steel Chronograph Watch', 'WTC-STL-02', 'TKS-WTC-0002', 'Stainless steel chronograph with date display; water resistant to 100 m.', 6, 8900.00, NULL, '2 years', 'Anadolu Saat Dağıtım Ltd.'),
  ('Watches', 'Minimalist Mesh Watch', 'WTC-MSH-03', 'TKS-WTC-0003', 'Slim watch with a silver mesh strap and a clean white dial.', 22, 3150.00, NULL, '2 years', 'Anadolu Saat Dağıtım Ltd.'),
  ('Watches', 'Digital Sport Watch', 'WTC-DGT-04', 'TKS-WTC-0004', 'Digital sport watch with stopwatch, alarm and backlight; silicone strap.', 0, 2490.00, 1100.00, '1 year', 'Anadolu Saat Dağıtım Ltd.'),
  ('Watches', 'Rose Gold Women''s Watch', 'WTC-RGD-05', 'TKS-WTC-0005', 'Rose gold-tone watch with a small round dial and bracelet strap.', 9, 3790.00, NULL, '2 years', 'Anadolu Saat Dağıtım Ltd.')
) AS v(category, name, model, serial_number, description,
       stock_quantity, price, cost, warranty_status, distributor)
JOIN categories c ON c.name = v.category;

COMMIT;