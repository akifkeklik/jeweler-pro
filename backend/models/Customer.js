const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    name: { type: String, required: true },
    phone: String,
    email: String,
    address: String,
    customerType: { type: String, enum: ["bireysel", "kurumsal"], default: "bireysel" }
}, { timestamps: true, _id: false });

// 8 haneli ID üretici
function generate8DigitId() {
    return Math.floor(10000000 + Math.random() * 90000000);
}

customerSchema.pre("save", async function (next) {
    if (!this._id) {
        let newId;
        let exists = true;
        while (exists) {
            newId = generate8DigitId();
            exists = await mongoose.models.Customer.exists({ _id: newId });
        }
        this._id = newId;
    }
    next();
});

module.exports = mongoose.model("Customer", customerSchema);
