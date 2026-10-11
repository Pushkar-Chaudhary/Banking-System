require('dotenv').config();
const mongoose = require('mongoose');
const userModel = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const { ensureDefaultCategories } = require('../src/services/catalog.service');

const sellerEmail = process.env.DEMO_SELLER_EMAIL || 'demo-seller@sajilopasal.local';
const demoProducts = [
  {
    slug: 'demo-seasonal-garden-greens',
    name: 'Seasonal Garden Greens',
    description: 'A fresh seasonal mix from a small Kathmandu Valley grower.',
    price: 180,
    stock: 12,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Bagmati', district: 'Kathmandu', municipality: 'Kirtipur', ward: '' },
    images: ['https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-ilam-orthodox-tea',
    name: 'Ilam Orthodox Tea',
    description: 'Fragrant whole-leaf tea inspired by the gardens of eastern Nepal.',
    price: 450,
    stock: 8,
    category: 'drinks',
    location: { country: 'Nepal', province: 'Koshi', district: 'Ilam', municipality: 'Suryodaya', ward: '' },
    images: ['https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-himalayan-wildflower-honey',
    name: 'Himalayan Wildflower Honey',
    description: 'A small-batch pantry favourite from Nepal’s hillside communities.',
    price: 650,
    stock: 6,
    category: 'grocery',
    location: { country: 'Nepal', province: 'Gandaki', district: 'Lamjung', municipality: 'Besisahar', ward: '' },
    images: ['https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-mountain-orchard-apples',
    name: 'Mountain Orchard Apples',
    description: 'Crisp orchard fruit selected for a simple, local fruit bowl.',
    price: 320,
    stock: 10,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Gandaki', district: 'Mustang', municipality: 'Gharpajhong', ward: '' },
    images: ['https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-terai-basmati-rice',
    name: 'Terai Basmati Rice (5 kg)',
    description: 'Aromatic long-grain rice from the fields of Rupandehi.',
    price: 850,
    stock: 15,
    category: 'grocery',
    location: { country: 'Nepal', province: 'Lumbini', district: 'Rupandehi', municipality: 'Butwal', ward: '' },
    images: ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-jumli-marshi-red-rice',
    name: 'Jumli Marshi Red Rice (2 kg)',
    description: 'Cold-climate red rice grown in the high valleys of Jumla.',
    price: 450,
    stock: 7,
    category: 'grocery',
    location: { country: 'Nepal', province: 'Karnali', district: 'Jumla', municipality: 'Chandannath', ward: '' },
    images: ['https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-nuwakot-vine-tomatoes',
    name: 'Nuwakot Vine Tomatoes',
    description: 'Sun-ripened tomatoes picked the same morning from Nuwakot hills.',
    price: 120,
    stock: 18,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Bagmati', district: 'Nuwakot', municipality: 'Bidur', ward: '' },
    images: ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-kavre-orchard-oranges',
    name: 'Kavre Orchard Oranges',
    description: 'Sweet citrus from the orange gardens of Kavrepalanchok.',
    price: 280,
    stock: 14,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Bagmati', district: 'Kavrepalanchok', municipality: 'Banepa', ward: '' },
    images: ['https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-gulmi-highland-coffee',
    name: 'Gulmi Highland Coffee Beans (250 g)',
    description: 'Hand-picked arabica beans from the coffee hills of Gulmi.',
    price: 750,
    stock: 9,
    category: 'drinks',
    location: { country: 'Nepal', province: 'Lumbini', district: 'Gulmi', municipality: 'Tamghas', ward: '' },
    images: ['https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-tarai-malda-mangoes',
    name: 'Tarai Malda Mangoes',
    description: 'Juicy Malda mangoes from the orchards of the eastern Tarai.',
    price: 350,
    stock: 8,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Madhesh', district: 'Dhanusha', municipality: 'Janakpur', ward: '' },
    images: ['https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-dhangadhi-dairy-milk',
    name: 'Dhangadhi Dairy Milk (1 L)',
    description: 'Fresh morning milk delivered from a family dairy in Kailali.',
    price: 95,
    stock: 24,
    category: 'grocery',
    location: { country: 'Nepal', province: 'Sudurpashchim', district: 'Kailali', municipality: 'Dhangadhi', ward: '' },
    images: ['https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=900&q=80']
  },
  {
    slug: 'demo-mustang-red-potatoes',
    name: 'Mustang Red Potatoes (5 kg)',
    description: 'Famous high-altitude potatoes from the terraces of Mustang.',
    price: 90,
    stock: 20,
    category: 'vegetables',
    location: { country: 'Nepal', province: 'Gandaki', district: 'Mustang', municipality: 'Gharpajhong', ward: '' },
    images: ['https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=80']
  }
];

async function seedDemoCatalog() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo catalog seeding is disabled in production');
  }
  if (!process.env.DEMO_SELLER_PASSWORD || process.env.DEMO_SELLER_PASSWORD.length < 12) {
    throw new Error('Set DEMO_SELLER_PASSWORD to a private value of at least 12 characters in your local .env');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI);
  await ensureDefaultCategories();

  let seller = await userModel.findOne({ email: sellerEmail });
  if (!seller) {
    seller = await userModel.create({
      name: 'Sajilo Local Market Demo Seller',
      email: sellerEmail,
      password: process.env.DEMO_SELLER_PASSWORD,
      role: 'seller'
    });
  } else if (seller.role !== 'seller') {
    throw new Error('The configured demo seller email belongs to a non-seller account');
  }

  for (const product of demoProducts) {
    await Product.updateOne(
      { slug: product.slug },
      { $setOnInsert: { ...product, seller: seller._id, isActive: true, sellerModeActive: true } },
      { upsert: true, runValidators: true }
    );
  }
  console.log(`Demo seller and ${demoProducts.length} catalog items are ready. Demo seller email: ${sellerEmail}`);
}

seedDemoCatalog()
  .catch((error) => {
    console.error('Demo catalog seeding failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
