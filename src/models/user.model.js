const mongoose = require ('mongoose');
const bcrypt = require('bcrypt');

const cartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    }
}, { _id: true });

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required:[true,"Name is required for creating a user"],
        trim: true
    },
    email: {
        type: String,
        required:[true,"Email is required for creating a user"],
        lowercase: true,
        trim: true,
        match:[/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Please provide a valid email address"],
        unique:[true,"Email already exists"]
    },
    password: {
        type: String,
        required:[true,"Password is required for creating a user"],
        minlength:[8,"Password must be at least 8 characters long"],
        select:false
    },
    role: {
        type: String,
        enum: ['buyer', 'seller', 'admin'],
        default: 'buyer'
    },
    paymentSettings: {
        esewa: {
            phoneNumber: {
                type: String,
                trim: true,
                maxlength: 16
            },
            merchantCode: {
                type: String,
                trim: true,
                maxlength: 80
            },
            secretCiphertext: {
                type: String,
                select: false
            }
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    sessionVersion: {
        type: Number,
        default: 0,
        select: false
    },
    phone: {
        type: String,
        default: ''
    },
    address: {
        type: String,
        default: ''
    },
    cart: {
        type: [cartItemSchema],
        default: []
    },
    wishlist: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'Product',
        default: []
    }
},
    {
        timestamps: true
    
})
userSchema.pre('save', async function(){
    this.email = typeof this.email === 'string' ? this.email.trim().toLowerCase() : this.email;
    if(!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
})
userSchema.methods.correctPassword = async function(candidatePassword, userPassword = this.password){
    return await bcrypt.compare(candidatePassword, userPassword);
}
userSchema.methods.comparePassword=async function(password){
    return await bcrypt.compare(password, this.password);
}
const userModel = mongoose.model("user", userSchema);
module.exports = userModel;