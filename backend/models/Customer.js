const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    email: String,
    address: String,
    customerType: { type: String, enum: ["bireysel", "kurumsal"], default: "bireysel" }
}, { timestamps: true, _id: false });

function generateId() {
    return Math.floor(10000000 + Math.random() * 90000000);
}

// Mongoose validation runs before pre-save middleware; assign the required
// numeric ID in pre-validate so a new document passes required-field checks.
customerSchema.pre("validate", async function () {
    if (!this.isNew || this._id != null) return;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = generateId();
        const exists = await mongoose.models.Customer.exists({ _id: candidate });
        if (!exists) {
            this._id = candidate;
            return;
        }
    }

    throw new Error("Could not allocate a unique customer ID after 10 attempts");
});

module.exports = mongoose.model("Customer", customerSchema);
