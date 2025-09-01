const mongoose = require("mongoose");

const materialSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    name: { type: String, required: true }
}, { _id: false });

// 6 haneli ID üretici
function generate6DigitId() {
    return Math.floor(100000 + Math.random() * 900000);
}

materialSchema.pre("save", async function (next) {
    if (!this._id) {
        let newId;
        let exists = true;
        while (exists) {
            newId = generate6DigitId();
            exists = await mongoose.models.Material.exists({ _id: newId });
        }
        this._id = newId;
    }
    next();
});

module.exports = mongoose.model("Material", materialSchema);
