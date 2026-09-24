const express=require("express"),cors=require("cors"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),fs=require("fs"),path=require("path");
const app=express(),PORT=process.env.PORT||10000,SECRET=process.env.JWT_SECRET||"change-this-secret",DB=path.join(__dirname,"data","users.json"),SET=path.join(__dirname,"data","settings.json"),PAY=path.join(__dirname,"data","payments.json");
app.use(cors());app.use(express.json({limit:"2mb"}));
const read=(f,d=[])=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}},write=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x,null,2))};
const defaults={appName:"SnapScale",theme:"yellow",logoUrl:"",price:99,currency:"INR",upiId:"",upiName:"",qrImage:"",bankName:"",accountName:"",accountNumber:"",ifsc:"",purchaseTitle:"SnapScale Pro"};
function settings(){return {...defaults,...read(SET,{})}};function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||"").replace("Bearer ",""),SECRET);next()}catch{res.status(401).json({error:"Unauthorized"})}}function admin(req,res,next){if(req.user?.role!=="admin")return res.status(403).json({error:"Admin only"});next()}
app.get("/api/health",(q,s)=>s.json({ok:true,service:"SnapScale API"}));
app.get("/api/public/settings",(q,s)=>{let x=settings();s.json({...x,accountNumber:x.accountNumber?"****"+x.accountNumber.slice(-4):""})});
app.post("/api/auth/register",async(q,s)=>{let{name,email,password}=q.body;email=(email||"").trim().toLowerCase();if(!name||!email||!password||password.length<6)return s.status(400).json({error:"Name, email and 6+ character password required"});let u=read(DB);if(u.some(x=>x.email===email))return s.status(409).json({error:"Email already registered"});let x={id:Date.now().toString(),name,email,password:await bcrypt.hash(password,12),role:"user",createdAt:new Date().toISOString(),purchase:null};u.push(x);write(DB,u);s.status(201).json({token:jwt.sign({id:x.id,email:x.email,role:x.role},SECRET,{expiresIn:"30d"}),user:{name:x.name,email:x.email,role:x.role,purchase:null}})});
app.post("/api/auth/login",async(q,s)=>{let email=(q.body.email||"").trim().toLowerCase(),u=read(DB).find(x=>x.email===email);if(!u||!(await bcrypt.compare(q.body.password||"",u.password)))return s.status(401).json({error:"Invalid email or password"});s.json({token:jwt.sign({id:u.id,email:u.email,role:u.role},SECRET,{expiresIn:"30d"}),user:{name:u.name,email:u.email,role:u.role,purchase:u.purchase||null}})});
app.get("/api/me",auth,(q,s)=>{let u=read(DB).find(x=>x.id===q.user.id);u?s.json({user:{name:u.name,email:u.email,role:u.role,purchase:u.purchase||null}}):s.status(404).json({error:"User not found"})});
app.get("/api/payment/config",(q,s)=>s.json({enabled:!!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET),keyId:process.env.RAZORPAY_KEY_ID||""}));
app.post("/api/payment/create-order",auth,async(q,s)=>{
  try{
    if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return s.status(503).json({error:"Automatic payment gateway is not configured yet"});
    const Razorpay=require("razorpay");
    const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
    const amount=Math.round((Number(q.body.amount)||settings().price)*100);
    const order=await rz.orders.create({amount,currency:"INR",receipt:"ss_"+q.user.id+"_"+Date.now(),notes:{userId:q.user.id}});
    s.json({orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID});
  }catch(e){s.status(500).json({error:"Could not create payment order"})}
});
app.post("/api/payment/verify",auth,async(q,s)=>{
  try{
    const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=q.body;
    if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature)return s.status(400).json({error:"Payment verification data missing"});
    const crypto=require("crypto"),expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(razorpay_signature)))return s.status(400).json({error:"Payment signature verification failed"});
    const Razorpay=require("razorpay"),rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
    const payment=await rz.payments.fetch(razorpay_payment_id);
    const amount=Number(payment.amount)/100;
    if(payment.order_id!==razorpay_order_id||payment.currency!=="INR"||payment.status!=="captured")return s.status(400).json({error:"Payment is not captured"});
    const u=read(DB),i=u.findIndex(x=>x.id===q.user.id);if(i<0)return s.status(404).json({error:"User not found"});
    const now=new Date().toISOString();
    u[i].purchase={status:"approved",transactionId:razorpay_payment_id,orderId:razorpay_order_id,amount,createdAt:u[i].purchase?.createdAt||now,approvedAt:now,provider:"razorpay"};
    write(DB,u);
    const p=read(PAY);if(!p.some(x=>x.transactionId===razorpay_payment_id)){p.push({userId:u[i].id,email:u[i].email,transactionId:razorpay_payment_id,orderId:razorpay_order_id,amount,status:"approved",provider:"razorpay",createdAt:now,approvedAt:now});write(PAY,p)}
    s.json({ok:true,status:"approved",purchase:u[i].purchase});
  }catch(e){s.status(500).json({error:"Automatic payment verification failed"})}
});
app.post("/api/purchase",auth,(q,s)=>{let{transactionId,amount}=q.body;if(!transactionId)return s.status(400).json({error:"Transaction ID required"});let u=read(DB),i=u.findIndex(x=>x.id===q.user.id);if(i<0)return s.status(404).json({error:"User not found"});u[i].purchase={status:"pending",transactionId:String(transactionId).trim(),amount:Number(amount)||settings().price,createdAt:new Date().toISOString()};write(DB,u);let p=read(PAY);p.push({userId:u[i].id,email:u[i].email,transactionId:String(transactionId).trim(),amount:Number(amount)||settings().price,status:"pending",createdAt:new Date().toISOString()});write(PAY,p);s.json({ok:true,status:"pending"})});
app.get("/api/admin/users",auth,admin,(q,s)=>s.json(read(DB).map(({password,...u})=>u)));
app.get("/api/admin/payments",auth,admin,(q,s)=>s.json(read(PAY)));
app.get("/api/admin/stats",auth,admin,(q,s)=>{let u=read(DB),p=read(PAY);s.json({users:u.length,admins:u.filter(x=>x.role==="admin").length,pendingPayments:p.filter(x=>x.status==="pending").length,approvedPayments:p.filter(x=>x.status==="approved").length})});
app.get("/api/admin/settings",auth,admin,(q,s)=>s.json(settings()));
app.put("/api/admin/settings",auth,admin,(q,s)=>{let old=settings(),x={...old,...q.body};write(SET,x);s.json(x)});
app.post("/api/admin/payments/:id/approve",auth,admin,(q,s)=>{let p=read(PAY),i=p.findIndex(x=>x.transactionId===q.params.id);if(i<0)return s.status(404).json({error:"Payment not found"});p[i].status="approved";p[i].approvedAt=new Date().toISOString();write(PAY,p);let u=read(DB),j=u.findIndex(x=>x.id===p[i].userId);if(j>=0){u[j].purchase={...u[j].purchase,status:"approved",approvedAt:p[i].approvedAt};write(DB,u)}s.json({ok:true})});
let users=read(DB),ae=(process.env.ADMIN_EMAIL||"admin@snapscale.app").toLowerCase();if(!users.some(x=>x.email===ae)){users.push({id:"admin",name:"SnapScale Admin",email:ae,password:bcrypt.hashSync(process.env.ADMIN_PASSWORD||"ChangeMe123!",12),role:"admin",createdAt:new Date().toISOString(),purchase:null});write(DB,users)}
app.use(express.static(path.join(__dirname,"public")));app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));app.listen(PORT,()=>console.log("SnapScale server on "+PORT));