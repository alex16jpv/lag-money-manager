"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("Accounts", ["userId", "id"], {
      name: "idx_accounts_userId_id",
    });
    await queryInterface.addIndex("Categories", ["userId", "id"], {
      name: "idx_categories_userId_id",
    });
    await queryInterface.addIndex("Transactions", ["userId", "id"], {
      name: "idx_transactions_userId_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("Accounts", "idx_accounts_userId_id");
    await queryInterface.removeIndex("Categories", "idx_categories_userId_id");
    await queryInterface.removeIndex(
      "Transactions",
      "idx_transactions_userId_id",
    );
  },
};
