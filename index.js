const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require("firebase-admin");

const serviceAccount = require("./contest-hub-frontend-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vqc4z0k.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
// middleware 
app.use(express.json());
app.use(cors())

const verifyFBToken=async(req, res, next)=>{
  const token =req.headers?.authorization;

  if(!token){
    return res.status(401).send({message: "Unauthorized access"})
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded= await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next()
  } catch (error) {
    res.status(401).send({message:"Unauthorized access"})
  }

}
app.get('/', (req, res) => {
  res.send('Hello World!')
})
// get api

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contest-hub-db");
    const usersCollection = db.collection("users");
    const contestCollection= db.collection("contests");

    // contest related API 
    app.post('/contests',async(req, res)=>{
      const contestInfo=req.body;
      console.log(contestInfo);
      const result= await contestCollection.insertOne(contestInfo)
      res.send(result);
    })

    app.get('/contests',async(req,res)=>{
       const result=await contestCollection.find().toArray()
       res.send(result);
    })


    app.get('/contests/:search',async(req, res)=>{
      const search=req.params.search;
      const query={}
      if(ObjectId.isValid(search)&& search.length === 24){
        query._id= new ObjectId(search)
      }else{
        query.creatorEmail=search;
      }
      
      const result= await contestCollection.find(query).toArray()
      res.send(result)
    })


    // user related API 
    app.post('/users',async(req, res)=>{
      const userInfo=req.body;
      userInfo.role="user";
      userInfo.createdAt=new Date()
      const email= userInfo.email;
      const existingUser = await usersCollection.findOne({email});
      if(existingUser){
        return res.status(409).send({message:"Email already exists"})
      }

      const result = await usersCollection.insertOne(userInfo);
      res.send(result);

    })

    // app.get('/users',async(req, res)=>{
      
    //   const result = await usersCollection.find().toArray()
    //   res.send(result)
    // })
    app.get('/users/:email',verifyFBToken,async(req, res)=>{
      const email = req.params.email;
      const query={email};
      const user = await usersCollection.findOne(query)
      res.send(user)
    })
    app.get('/users/:email/role',verifyFBToken,async(req, res)=>{
      const email = req.params.email;
      const query={email};
      const user = await usersCollection.findOne(query)
      res.send({role:user?.role || 'user'})
    })

    app.patch('/users/:email', async(req, res)=>{
      const email = req.params.email;
      const bioInfo = req.body.bio;
      const query={}
      if(email){
        query.email=email
      }


      updatedInfo={
        $set:{
          bio: bioInfo
        }
      }
      console.log(updatedInfo);
      const result = await usersCollection.updateOne(query,updatedInfo)
      res.send(result);
    })



    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
