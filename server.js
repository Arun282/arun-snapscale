const express=require("express");
const cors=require("cors");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const fs=require("fs");
const path=require("path");
const app=express();
const PORT=process.env.PORT||10000;
const JWT_SECRET=process.env.JWT_SECRET||"change-this-in-render";
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"admin").toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"change-me";
const DATA=path.join(__dirname,"data");
fs.mkdirSync(DATA,{recursive:true});
const file=n=>path.join(DATA,n);
function read(n,d){try{return JSON.parse(fs.readFileSync(file(n),"utf8"))}catch{return d}}
function write(n,v){fs.writeFileSync(file(n),JSON.stringify(v,null,2))}
let users=read("users.json",[]);
let settings=read("settings.json",{appName:"SnapScale",proPrice:99,purchaseTitle:"SnapScale Pro",theme:"dark",logoUrl:""});
let payments=read("payments.json",[]);
function save(){write("users.json",users);write("settings.json",settings);write("payments.json",payments)}
if(!users.find(u=>u.email===ADMIN_EMAIL)){users.push({id:"admin",name:"SnapScale Admin",email:ADMIN_EMAIL,password:bcrypt.hashSync(ADMIN_PASSWORD,10),role:"admin",pro:true});save()}
app.use(cors());app.use(express.json({limit:"2mb"}));app.use(express.static(path.join(__dirname,"public")));
function auth(req,res,next){try{const t=(req.headers.authorization||"").replace("Bearer ","");req.user=jwt.verify(t,JWT_SECRET);next()}catch{res.status(401).json({error:"Login required"})}}
function admin(req,res,next){if(req.user?.role!=="admin")return res.status(403).json({error:"Admin only"});next()}
app.get("/api/health",(req,res)=>res.json({ok:true,app:"SnapScale"}));
app.get("/api/public/settings",(req,res)=>res.json(settings));
app.post("/api/register",(req,res)=>{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");if(!email||password.length<6)return res.status(400).json({error:"Valid email and 6+ character password required"});if(users.some(u=>u.email===email))return res.status(409).json({error:"Account already exists"});const u={id:Date.now().toString(),name:String(req.body.name||"User"),email,password:bcrypt.hashSync(password,10),role:"user",pro:false};users.push(u);save();res.json({ok:true})});
app.post("/api/login",(req,res)=>{const email=String(req.body.email||"").trim().toLowerCase(),u=users.find(x=>x.email===email);if(!u||!bcrypt.compareSync(String(req.body.password||""),u.password))return res.status(401).json({error:"Invalid login"});res.json({token:jwt.sign({id:u.id,email:u.email,role:u.role},JWT_SECRET,{expiresIn:"30d"}),user:{id:u.id,name:u.name,email:u.email,role:u.role,pro:!!u.pro}})});
app.get("/api/me",auth,(req,res)=>{const u=users.find(x=>x.id===req.user.id);res.json({id:u.id,name:u.name,email:u.email,role:u.role,pro:!!u.pro})});
app.post("/api/purchase",auth,(req,res)=>{const p={id:Date.now().toString(),userId:req.user.id,amount:Number(req.body.amount||settings.proPrice),transactionId:String(req.body.transactionId||""),status:"pending",createdAt:new Date().toISOString()};if(!p.transactionId)return res.status(400).json({error:"Transaction ID required"});payments.unshift(p);save();res.json({ok:true,payment:p})});
app.get("/api/admin/users",auth,admin,(req,res)=>res.json(users.map(({password,...u})=>u)));
app.get("/api/admin/payments",auth,admin,(req,res)=>res.json(payments));
app.get("/api/admin/stats",auth,admin,(req,res)=>res.json({users:users.length,pro:users.filter(u=>u.pro).length,pending:payments.filter(p=>p.status==="pending").length,approved:payments.filter(p=>p.status==="approved").length}));
app.put("/api/admin/settings",auth,admin,(req,res)=>{settings={...settings,...req.body};save();res.json(settings)});
app.post("/api/admin/payments/:id/approve",auth,admin,(req,res)=>{const p=payments.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Payment not found"});p.status="approved";p.approvedAt=new Date().toISOString();const u=users.find(x=>x.id===p.userId);if(u)u.pro=true;save();res.json({ok:true,payment:p})});
app.listen(PORT,()=>console.log("SnapScale API running on "+PORT));