const fs=require('node:fs/promises');
const path=require('node:path');
async function createTestDirectory(prefix){
 // MXC virtualizes os.tmpdir(); use an explicit project directory for atomic I/O.
 const base=path.resolve(__dirname,'../../.overnight/tmp');
 await fs.mkdir(base,{recursive:true});
 return fs.mkdtemp(path.join(base,prefix));
}
module.exports={createTestDirectory};
