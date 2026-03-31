"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Categories", "emoji", {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Categories", "emoji");
  },
};
