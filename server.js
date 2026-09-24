const express=require("express");const cors=require("cors");const bcrypt=require("bcryptjs");const jwt=require("jsonwebtoken");const mongoose=require("mongoose");const path=require("path");
const app=express();app.use(cors());app.use(express.json({limit:"2mb"}));
const PORT=process.env.PORT||10000, MONGO_URI=process.env.MONGO_URI, JWT_SECRET=process.env.JWT_SECRET||"change-me";
const UserSchema=new mongoose.Schema({name:String,email:{type:String,unique:true,lowercase:true},password:String,role:{type:String,enum:["user","admin"],default:"user"},createdAt:{type:Date,default:Date.now}});
const User=mongoose.model("User",UserSchema);
function auth(req,res,next){try{const h=req.headers.authorization||"";req.user=jwt.verify(h.replace("Bearer ",""),JWT_SECRET);next()}catch(e){res.status(401).json({error:"Unauthorized"})}}
function admin(req,res,next){if(req.user?.role!=="admin")return res.status(403).json({error:"Admin only"});next()}
app.get("/api/health",(req,res)=>res.json({ok:true,service:"SnapScale API"}));
app.post("/api/auth/register",async(req,res)=>{try{const{name,email,password}=req.body;if(!name||!email||!password||password.length<6)return res.status(400).json({error:"Name, email and 6+ character password required"});if(await User.findOne({email}))return res.status(409).json({error:"Email already registered"});const user=await User.create({name,email,password:await bcrypt.hash(password,12)});res.status(201).json({token:jwt.sign({id:user._id,email:user.email,role:user.role},JWT_SECRET,{expiresIn:"30d"}),user:{name:user.name,email:user.email,role:user.role}})}catch(e){res.status(500).json({error:"Registration failed"})}});
app.post("/api/auth/login",async(req,res)=>{const{email,password}=req.body;const user=await User.findOne({email});if(!user||!(await bcrypt.compare(password,user.password)))return res.status(401).json({error:"Invalid email or password"});res.json({token:jwt.sign({id:user._id,email:user.email,role:user.role},JWT_SECRET,{expiresIn:"30d"}),user:{name:user.name,email:user.email,role:user.role}})});
app.get("/api/me",auth,async(req,res)=>{const u=await User.findById(req.user.id).select("-password");res.json({user:u})});
app.get("/api/admin/users",auth,admin,async(req,res)=>res.json(await User.find().select("-password").sort({createdAt:-1})));
app.get("/api/admin/stats",auth,admin,async(req,res)=>res.json({users:await User.countDocuments(),admins:await User.countDocuments({role:"admin"})}));
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
async function start(){if(!MONGO_URI){console.error("MONGO_URI missing");process.exit(1)}await mongoose.connect(MONGO_URI);if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&!await User.findOne({email:process.env.ADMIN_EMAIL}))await User.create({name:"Admin",email:process.env.ADMIN_EMAIL,password:await bcrypt.hash(process.env.ADMIN_PASSWORD,12),role:"admin"});app.listen(PORT,()=>console.log("SnapScale API running on "+PORT))}
start().catch(e=>{console.error(e);process.exit(1)});